import { create } from 'zustand';

import { defaults } from '@/config/appConfig';
import { log } from '@/lib/log';
import type { Transport } from '@/net/transport';
import type {
  ConnectionState,
  HealthSnapshot,
  ServerMessage,
  UmpireEnd,
} from '@/types/protocol';
import { PROTOCOL_VERSION } from '@/types/protocol';

import { useClips } from './clipStore';
import { useMatch } from './matchStore';

/**
 * Owns the control channel and nothing else.
 *
 * It does not know whether the transport underneath is a WebSocket or the mock,
 * and it does not download anything. Its job is: hold the link open, keep the
 * connection pill honest, and hand each message to whoever owns that state.
 */

interface ConnectionStore {
  state: ConnectionState;
  transportName: string | null;
  isMock: boolean;

  cameraId: string | null;
  firmware: string | null;
  vestProtocol: number | null;
  umpireEnd: UmpireEnd | null;
  ringSize: number | null;

  health: HealthSnapshot | null;
  recording: boolean;
  lastMessageAt: number | null;
  rttMs: number | null;
  /** Set when the vest speaks a protocol version this build cannot understand. */
  protocolMismatch: boolean;

  attach: (transport: Transport) => void;
  detach: () => void;
  resync: () => void;
}

let active: Transport | null = null;
let unsubscribe: (() => void) | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;

export const useConnection = create<ConnectionStore>((set, get) => ({
  state: 'disconnected',
  transportName: null,
  isMock: false,
  cameraId: null,
  firmware: null,
  vestProtocol: null,
  umpireEnd: null,
  ringSize: null,
  health: null,
  recording: false,
  lastMessageAt: null,
  rttMs: null,
  protocolMismatch: false,

  attach: (transport) => {
    get().detach();
    active = transport;
    set({ transportName: transport.name, isMock: transport.isMock });

    unsubscribe = transport.subscribe({
      onState: (state) => set({ state }),
      onMessage: (message) => handle(set, get, message),
    });

    transport.connect();

    heartbeat = setInterval(() => {
      if (get().state !== 'connected') return;
      active?.send({ v: PROTOCOL_VERSION, type: 'ping', t: Date.now() / 1000 });
    }, defaults.heartbeatSeconds * 1000);

    log.info('link', `attached ${transport.name}`);
  },

  detach: () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    unsubscribe?.();
    unsubscribe = null;
    active?.disconnect();
    active = null;
    set({ state: 'disconnected', recording: false, transportName: null });
  },

  /**
   * "What did I miss?" Sent on reconnect and by pull-to-refresh, which umpires
   * do reflexively when they are unsure, so it needs to do something real.
   */
  resync: () => {
    const highest = useClips.getState().clips.find((c) => c.status === 'ready')?.seq ?? 0;
    active?.send({ v: PROTOCOL_VERSION, type: 'resync', since_seq: highest });
    log.debug('link', `resync since ${highest}`);
  },
}));

function handle(
  set: (p: Partial<ConnectionStore>) => void,
  get: () => ConnectionStore,
  message: ServerMessage
) {
  set({ lastMessageAt: Date.now() });

  switch (message.type) {
    case 'hello':
      set({
        cameraId: message.camera_id,
        firmware: message.firmware,
        vestProtocol: message.protocol,
        umpireEnd: message.end ?? null,
        ringSize: message.ring_size ?? null,
        protocolMismatch: message.protocol > PROTOCOL_VERSION,
      });
      if (message.protocol > PROTOCOL_VERSION) {
        log.warn('link', `vest speaks protocol ${message.protocol}, this build speaks ${PROTOCOL_VERSION}`);
      }
      break;

    case 'session_state':
      set({ recording: message.state === 'recording' });
      // A START press is a delivery. Count it here rather than when the clip
      // lands, so the counter is right even for the balls that produce nothing.
      if (message.state === 'recording') useMatch.getState().countDelivery();
      break;

    case 'clip_ready':
      void useClips.getState().onClipReady(message);
      break;

    case 'clip_expired':
      void useClips.getState().onClipExpired(message.camera_id, message.seq);
      break;

    case 'status':
      set({ health: message.health });
      break;

    case 'pong':
      set({ rttMs: Math.round((Date.now() / 1000 - message.t) * 1000) });
      break;
  }
  void get;
}
