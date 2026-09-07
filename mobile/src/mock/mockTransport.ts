import { log } from '@/lib/log';
import type { Transport, TransportHandlers } from '@/net/transport';
import type { ClientMessage, ClosedBy, ServerMessage } from '@/types/protocol';
import { PROTOCOL_VERSION } from '@/types/protocol';

import { MOCK_CLIP } from './sampleClip';

export interface MockTransportOptions {
  /**
   * Seconds between deliveries when nobody is tapping. Zero means the vest sits
   * there and waits for the umpire, which is the honest default now that the
   * control is in the app: you drive it.
   */
  ballIntervalSeconds: number;
  /** Seconds an auto-bowled delivery stays open. Ignored when driven by taps. */
  recordingSeconds: number;
  /** Fraction of deliveries that never produce a clip, so the grey dot is seen. */
  failureRate: number;
  /** Depth of the pretend rolling buffer, in seconds. */
  bufferSeconds: number;
  cameraId: string;
  matchId: string;
  startingSeq: number;
}

const DEFAULTS: Omit<MockTransportOptions, 'matchId'> = {
  ballIntervalSeconds: 0,
  recordingSeconds: 4,
  failureRate: 0.08,
  bufferSeconds: 300,
  cameraId: 'vest-01',
  startingSeq: 0,
};

/**
 * A vest that does not exist.
 *
 * It no longer bowls on a timer by default. The control moved into the app, so
 * the mock's job changed: it waits for markers and cuts clips out of a pretend
 * buffer, which is exactly what the real vest will do. Tap the button, get a
 * clip - the whole loop is now exercisable on a phone with no hardware at all.
 *
 * It still fails on purpose. Roughly one delivery in twelve produces no clip, or
 * one that closed on a timeout, or one recovered from the buffer, because those
 * states need to be seen during ordinary development rather than discovered on
 * a Saturday.
 *
 * The auto-bowl mode is kept behind a setting for demonstrating a full over
 * without standing there tapping.
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
  /** Deliveries the phone has opened but not closed, by sequence number. */
  private open = new Map<number, number>();

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
        firmware: '0.2.0-mock',
        end: 'bowlers',
        ring_size: 12,
        buffer_seconds: this.opts.bufferSeconds,
      });
      this.emitStatus();
      this.statusTimer = setInterval(() => this.emitStatus(), 10_000);

      if (this.opts.ballIntervalSeconds > 0) {
        this.autoBowl();
        this.ballTimer = setInterval(() => this.autoBowl(), this.opts.ballIntervalSeconds * 1000);
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
    this.open.clear();
    this.emitState('disconnected');
  }

  send(message: ClientMessage): void {
    log.debug('mock', `phone -> vest ${message.type}`, message);
    if (message.type === 'ping') {
      this.after(30, () =>
        this.emit({
          v: PROTOCOL_VERSION,
          type: 'pong',
          t: message.t,
          // The pretend vest runs about four seconds ahead, so the phone has a
          // real offset to discover rather than a convenient zero.
          vest_time: Date.now() / 1000 + 4.2,
        })
      );
      return;
    }
    if (message.type === 'mark') this.onMark(message.seq, message.edge, message.at);
  }

  /** Emergency "grab the last twenty seconds", cut straight from the buffer. */
  grabLastSeconds(seconds = 20): void {
    this.seq += 1;
    this.announce(this.seq, 'manual', seconds);
  }

  /* ---------- markers ---------- */

  private onMark(seq: number, edge: 'start' | 'end', at: number): void {
    if (!this.connected) return;
    this.seq = Math.max(this.seq, seq);

    if (edge === 'start') {
      this.open.set(seq, at);
      this.emit({
        v: PROTOCOL_VERSION,
        type: 'session_state',
        camera_id: this.opts.cameraId,
        state: 'recording',
        seq,
        since: at,
      });
      return;
    }

    const startedAt = this.open.get(seq);
    this.open.delete(seq);
    this.emit({
      v: PROTOCOL_VERSION,
      type: 'session_state',
      camera_id: this.opts.cameraId,
      state: this.open.size > 0 ? 'recording' : 'idle',
      seq,
      since: at,
    });

    // A ball that produces nothing. The case that must never be a surprise on
    // the field, so it happens regularly here.
    if (Math.random() < this.opts.failureRate) {
      log.warn('mock', `delivery ${seq} produced no clip`);
      return;
    }

    // An end with no start means the umpire missed the first tap. The vest can
    // still cut backwards out of the buffer, which is the whole reason the
    // buffer exists.
    if (startedAt === undefined) {
      this.after(250, () => this.announce(seq, 'recovered', 12));
      return;
    }

    const duration = Math.max(1, at - startedAt);
    const closedBy: ClosedBy = duration >= 39.5 ? 'timeout' : 'button';
    this.after(300, () => this.announce(seq, closedBy, duration));
  }

  /* ---------- demo mode ---------- */

  private autoBowl(): void {
    if (!this.connected) return;
    const seq = ++this.seq;
    const at = Date.now() / 1000;
    this.onMark(seq, 'start', at);
    this.after(this.opts.recordingSeconds * 1000, () =>
      this.onMark(seq, 'end', at + 12 + Math.random() * 4)
    );
  }

  /* ---------- emitters ---------- */

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
        buffer_held_s: this.opts.bufferSeconds,
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
