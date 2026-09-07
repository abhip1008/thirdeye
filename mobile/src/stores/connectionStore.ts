import { create } from 'zustand';

import { defaults } from '@/config/appConfig';
import { log } from '@/lib/log';
import type { Transport } from '@/net/transport';
import type {
  ClientMessage,
  ConnectionState,
  HealthSnapshot,
  ServerMessage,
  UmpireEnd,
} from '@/types/protocol';
import { PROTOCOL_VERSION } from '@/types/protocol';

import { useClips } from './clipStore';

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
  /** Depth of the vest's rolling buffer. How long a queued marker stays usable. */
  bufferSeconds: number | null;

  health: HealthSnapshot | null;
  recording: boolean;
  lastMessageAt: number | null;
  rttMs: number | null;
  /** Set when the vest speaks a protocol version this build cannot understand. */
  protocolMismatch: boolean;

  /**
   * Seconds to add to this phone's clock to get the vest's.
   *
   * Every marker is stamped in vest time, so the vest never has to track a
   * per-client offset and a second phone in v2 needs no extra work. Estimated
   * from the heartbeat: the pong carries the vest's own clock, and the round
   * trip says roughly when it was taken.
   */
  clockOffset: number;
  /** Round trip of the sample the offset came from. Lower is a better estimate. */
  clockOffsetRttMs: number | null;

  attach: (transport: Transport) => void;
  detach: () => void;
  resync: () => void;
  /** Vest-clock seconds. Falls back to phone time before the first pong. */
  vestNow: () => number;
  /** Returns false when the link is down, so the caller can queue instead. */
  send: (message: ClientMessage) => boolean;
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
  bufferSeconds: null,
  health: null,
  recording: false,
  lastMessageAt: null,
  rttMs: null,
  protocolMismatch: false,
  clockOffset: 0,
  clockOffsetRttMs: null,

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

  vestNow: () => Date.now() / 1000 + get().clockOffset,

  send: (message) => {
    if (!active || get().state !== 'connected') return false;
    try {
      active.send(message);
      return true;
    } catch (e) {
      log.warn('link', 'send failed', { type: message.type, error: String(e) });
      return false;
    }
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
        bufferSeconds: message.buffer_seconds ?? null,
        protocolMismatch: message.protocol > PROTOCOL_VERSION,
      });
      if (message.protocol > PROTOCOL_VERSION) {
        log.warn('link', `vest speaks protocol ${message.protocol}, this build speaks ${PROTOCOL_VERSION}`);
      }
      break;

    case 'session_state':
      // Confirmation, not the source of truth. The phone owns the delivery
      // state machine now; this only says the vest agrees. A disagreement is
      // worth surfacing rather than acting on, because the umpire's tap
      // happened whatever the vest thinks.
      set({ recording: message.state === 'recording' });
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

    case 'pong': {
      const now = Date.now() / 1000;
      const rttMs = Math.round((now - message.t) * 1000);
      set({ rttMs });

      // Keep the sample with the shortest round trip rather than the newest.
      // A long round trip means more uncertainty about when the vest actually
      // read its clock, so a quiet moment gives a better estimate than a busy
      // one - and the offset drifts far more slowly than the network varies.
      if (message.vest_time !== undefined) {
        const best = get().clockOffsetRttMs;
        if (best === null || rttMs <= best) {
          set({
            clockOffset: message.vest_time - (message.t + (now - message.t) / 2),
            clockOffsetRttMs: rttMs,
          });
        }
      }
      break;
    }
  }
  void get;
}
