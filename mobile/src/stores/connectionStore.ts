import { create } from 'zustand';

import { defaults } from '@/config/appConfig';
import { log } from '@/lib/log';
import type { Transport } from '@/net/transport';
import { observePong, vestNow, vestOffset, vestOffsetRttMs } from '@/net/vestClock';
import type {
  ClientMessage,
  ConnectionState,
  HealthSnapshot,
  ServerMessage,
  UmpireEnd,
} from '@/types/protocol';
import { PROTOCOL_VERSION } from '@/types/protocol';

import { useClips } from './clipStore';
import { useMatch } from './matchStore';
import { usePairing } from './pairingStore';

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
  /** Seconds of run-up the vest adds to every cut. Its setting, not the phone's. */
  prerollSeconds: number | null;

  health: HealthSnapshot | null;
  recording: boolean;
  lastMessageAt: number | null;
  rttMs: number | null;
  /** Set when the vest speaks a protocol version this build cannot understand. */
  protocolMismatch: boolean;
  /** Markers the vest could not use, with the last reason it gave. */
  refused: number;
  lastRefusal: string | null;

  /**
   * Seconds to add to this phone's clock to get the vest's.
   *
   * Every marker is stamped in vest time, so the vest never has to track a
   * per-client offset and a second phone in v2 needs no extra work. Mirrored
   * here for the diagnostics screen; `net/vestClock.ts` owns it, because signing
   * needs the same number before a control channel exists to learn it on.
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
  prerollSeconds: null,
  health: null,
  recording: false,
  lastMessageAt: null,
  rttMs: null,
  protocolMismatch: false,
  clockOffset: 0,
  clockOffsetRttMs: null,
  refused: 0,
  lastRefusal: null,

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

      /* A socket that is open is not a vest that is answering. When a vest
         loses power, or the phone walks out of range, TCP can hold the
         connection open for minutes before it admits anything is wrong - and
         for all of those minutes the pill says connected and the umpire has no
         reason to doubt it. The heartbeat is what makes that detectable: three
         missed pongs and the link is reported down, whatever the socket thinks.

         Same shape as the vest's own recording check. A thing existing is not
         the thing working. */
      const last = get().lastMessageAt;
      const silenceMs = defaults.heartbeatSeconds * defaults.missedPongsBeforeDown * 1000;
      if (last !== null && Date.now() - last > silenceMs) {
        log.warn('link', `no answer from the vest for ${Math.round((Date.now() - last) / 1000)}s`);
        set({ state: 'reconnecting', recording: false });
        // Tear it down so the transport's own reconnect takes over rather than
        // waiting on a socket that will not admit it is finished.
        active?.disconnect();
        active?.connect();
        return;
      }

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
    // The offset deliberately survives this. `attach` detaches first, and the
    // clock is often learned before the channel exists - the first signed HTTP
    // call is what corrects a vest that booted thinking it was last Tuesday.
    // Throwing it away here would discard that correction a moment before the
    // handshake that needs it. It is cleared when the phone pairs elsewhere.
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

  vestNow: () => vestNow(),

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

/** Plain language for the umpire. The detail goes to diagnostics instead. */
const REFUSAL_COPY: Record<string, string> = {
  no_match: 'the vest was restarted',
  too_old: 'it waited too long to reach the vest',
  buffer_miss: 'the vest had already recorded over it',
  cut_failed: 'the vest could not cut it',
};

/**
 * Tell the vest a match is running.
 *
 * Called when the vest says it has none. The two sides keep their own match
 * identifiers, so this is not a handshake - it is the phone making sure the
 * vest is in a state where a tap means something.
 */
async function adoptVest(): Promise<void> {
  const match = useMatch.getState().match;
  const host = usePairing.getState().host;
  if (!match || match.endedAt !== null || !host) return;
  log.warn('link', 'the vest has no match running; starting one');
  const { startVestSession } = await import('@/net/vestApi');
  await startVestSession(host, match.venue ?? '');
}

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
        prerollSeconds: message.preroll_seconds ?? null,
        protocolMismatch: message.protocol > PROTOCOL_VERSION,
      });
      if (message.protocol > PROTOCOL_VERSION) {
        log.warn('link', `vest speaks protocol ${message.protocol}, this build speaks ${PROTOCOL_VERSION}`);
      }

      /* The vest has no match but this phone does. That means the vest
         restarted underneath a connected phone - which it is built to survive,
         and which until now left every tap being refused with the umpire seeing
         nothing at all. Tell it again. `hello` arrives on every reconnect, so
         this covers the case without a timer or a poll. */
      if (message.match_id === null) void adoptVest();
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
      /* A clip arriving answers the question the refusal banner is asking.
         That banner means "a tap of yours produced nothing", which is worth
         interrupting an umpire for once - and then not again, for the rest of
         an innings, about a ball that is two overs old. The count is still on
         the diagnostics screen for anyone who wants the history. */
      if (get().refused > 0) set({ refused: 0, lastRefusal: null });
      break;

    case 'clip_expired':
      void useClips.getState().onClipExpired(message.camera_id, message.seq);
      break;

    case 'status':
      set({ health: message.health });
      break;

    case 'marker_refused': {
      // A tap that produced nothing. The umpire must not have to guess.
      const count = get().refused + 1;
      set({ refused: count, lastRefusal: REFUSAL_COPY[message.reason] ?? 'the vest could not use it' });
      log.warn('link', `the vest refused marker ${message.seq}/${message.edge}`, {
        reason: message.reason,
        detail: message.detail,
      });
      break;
    }

    case 'pong': {
      const now = Date.now() / 1000;
      set({ rttMs: Math.round((now - message.t) * 1000) });

      if (message.vest_time !== undefined) {
        observePong(message.vest_time, message.t, now);
        set({ clockOffset: vestOffset(), clockOffsetRttMs: vestOffsetRttMs() });
      }
      break;
    }
  }
  void get;
}
