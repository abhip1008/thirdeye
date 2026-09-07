import { log } from '@/lib/log';
import type { Transport, TransportHandlers } from '@/net/transport';
import type { ClientMessage, ClosedBy, ServerMessage } from '@/types/protocol';
import { PROTOCOL_VERSION } from '@/types/protocol';

import { MOCK_CLIP } from './sampleClip';

export interface MockTransportOptions {
  /** Seconds between deliveries. 40 is a real over's rhythm; 10 demos better. */
  ballIntervalSeconds: number;
  /** Seconds the vest stays in `recording` before the clip closes. */
  recordingSeconds: number;
  /** Fraction of clips that never arrive, so the failure path is exercised. */
  failureRate: number;
  cameraId: string;
  matchId: string;
  startingSeq: number;
}

const DEFAULTS: Omit<MockTransportOptions, 'matchId'> = {
  ballIntervalSeconds: 10,
  recordingSeconds: 4,
  failureRate: 0.08,
  cameraId: 'vest-01',
  startingSeq: 0,
};

/**
 * A vest that does not exist.
 *
 * It bowls on a timer: goes to `recording`, comes back to `idle`, announces a
 * clip, and occasionally does none of that so the grey dot appears without
 * anyone having to unplug a cable. Roughly one clip in twelve closes on a
 * timeout or gets recovered from the ring, because those badges need to be seen
 * during development rather than discovered on a Saturday.
 *
 * It implements exactly the `Transport` interface the real WebSocket client
 * will, and nothing else in the app knows which one it is talking to.
 */
export class MockTransport implements Transport {
  readonly name = 'MockTransport';
  readonly isMock = true;

  private opts: MockTransportOptions;
  private handlers: TransportHandlers | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private ballTimer: ReturnType<typeof setInterval> | null = null;
  private seq: number;
  private battery = 84;
  private connected = false;

  constructor(options: Partial<MockTransportOptions> & { matchId: string }) {
    this.opts = { ...DEFAULTS, ...options };
    this.seq = this.opts.startingSeq;
  }

  subscribe(handlers: TransportHandlers): () => void {
    this.handlers = handlers;
    return () => {
      if (this.handlers === handlers) this.handlers = null;
    };
  }

  connect(): void {
    if (this.connected) return;
    this.connected = true;
    this.emitState('connecting');

    this.after(400, () => {
      this.emitState('connected');
      this.emit({
        v: PROTOCOL_VERSION,
        type: 'hello',
        camera_id: this.opts.cameraId,
        match_id: this.opts.matchId,
        seq_latest: this.seq,
        protocol: PROTOCOL_VERSION,
        firmware: '0.1.0-mock',
        end: 'bowlers',
        ring_size: 12,
      });
      this.emitStatus();
      this.statusTimer = setInterval(() => this.emitStatus(), 10_000);

      // A zero interval means frozen: the link is up and the vest is healthy,
      // but no deliveries arrive. Useful for looking at a fixed list without it
      // shifting under you while you work on a row.
      if (this.opts.ballIntervalSeconds > 0) {
        this.bowl();
        this.ballTimer = setInterval(() => this.bowl(), this.opts.ballIntervalSeconds * 1000);
      }
    });
  }

  disconnect(): void {
    this.connected = false;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.ballTimer) clearInterval(this.ballTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.ballTimer = null;
    this.statusTimer = null;
    this.emitState('disconnected');
  }

  send(message: ClientMessage): void {
    log.debug('mock', `client -> vest ${message.type}`, message);
    if (message.type === 'ping') {
      this.after(30, () => this.emit({ v: PROTOCOL_VERSION, type: 'pong', t: message.t }));
    }
  }

  /** Emergency "grab the last 20 seconds", the same call the real vest exposes. */
  grabLastSeconds(): void {
    this.seq += 1;
    this.announce(this.seq, 'manual', 20);
  }

  private bowl(): void {
    if (!this.connected) return;
    this.seq += 1;
    const seq = this.seq;

    this.emit({
      v: PROTOCOL_VERSION,
      type: 'session_state',
      camera_id: this.opts.cameraId,
      state: 'recording',
      seq,
      since: Date.now() / 1000,
    });

    this.after(this.opts.recordingSeconds * 1000, () => {
      this.emit({
        v: PROTOCOL_VERSION,
        type: 'session_state',
        camera_id: this.opts.cameraId,
        state: 'idle',
        seq,
        since: Date.now() / 1000,
      });

      // A ball that never produces a clip. This is the case that must not be a
      // surprise on the field, so it happens regularly here.
      if (Math.random() < this.opts.failureRate) {
        log.warn('mock', `delivery ${seq} produced no clip`);
        return;
      }

      const roll = Math.random();
      const closedBy: ClosedBy = roll < 0.06 ? 'timeout' : roll < 0.12 ? 'recovered' : 'button';
      this.announce(seq, closedBy, closedBy === 'timeout' ? 40 : 12 + Math.random() * 5);
    });
  }

  private announce(seq: number, closedBy: ClosedBy, durationS: number): void {
    this.emit({
      v: PROTOCOL_VERSION,
      type: 'clip_ready',
      seq,
      camera_id: this.opts.cameraId,
      bytes: Math.round(durationS * 640_000),
      sha256: fakeHash(seq),
      duration_s: Number(durationS.toFixed(2)),
      closed_by: closedBy,
    });
  }

  private emitStatus(): void {
    this.battery = Math.max(4, this.battery - 0.4);
    this.emit({
      v: PROTOCOL_VERSION,
      type: 'status',
      camera_id: this.opts.cameraId,
      health: {
        battery_pct: Math.round(this.battery),
        temp_c: Number((48 + Math.random() * 6).toFixed(1)),
        disk_free_gb: 181,
        encoder_fps: Number((MOCK_CLIP.fps - Math.random() * 0.4).toFixed(1)),
        clips_held: Math.min(12, this.seq),
        buffer_held_s: 300,
      },
    });
  }

  private emit(message: ServerMessage): void {
    this.handlers?.onMessage(message);
  }

  private emitState(state: Parameters<TransportHandlers['onState']>[0]): void {
    this.handlers?.onState(state);
  }

  private after(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers = this.timers.filter((x) => x !== t);
      fn();
    }, ms);
    this.timers.push(t);
  }
}

/** Deterministic per-seq so a clip's hash does not change between renders. */
const fakeHash = (seq: number): string =>
  Array.from({ length: 64 }, (_, i) => (((seq * 31 + i * 17) % 16) >>> 0).toString(16)).join('');
