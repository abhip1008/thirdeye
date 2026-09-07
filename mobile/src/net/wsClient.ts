import { log } from '@/lib/log';
import type { ClientMessage, ConnectionState, ServerMessage } from '@/types/protocol';
import { parseServerMessage } from '@/types/protocol';

import type { Transport, TransportHandlers } from './transport';

/**
 * The real control channel.
 *
 * Drop-in for `MockTransport`: same interface, so the stores, the screens and
 * the delivery queue above it do not know which one they are attached to.
 *
 * Written for a link that will drop rather than one that works. An umpire walks
 * behind a sightscreen, a phone locks in a pocket, 2.4 GHz gets crowded at a
 * ground with two hundred people on it. Every one of those is a reconnect, not
 * an error, and the only thing that must never happen is the phone quietly
 * believing it is still connected.
 */
export class WebSocketTransport implements Transport {
  readonly name = 'WebSocketTransport';
  readonly isMock = false;

  private socket: WebSocket | null = null;
  private handlers: TransportHandlers | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private wanted = false;

  constructor(
    private readonly host: string,
    private readonly backoffMs: readonly number[] = [500, 1000, 2000, 4000, 8000, 10000]
  ) {}

  get url(): string {
    return `ws://${this.host}/ws`;
  }

  subscribe(handlers: TransportHandlers): () => void {
    this.handlers = handlers;
    return () => {
      if (this.handlers === handlers) this.handlers = null;
    };
  }

  connect(): void {
    this.wanted = true;
    this.open();
  }

  disconnect(): void {
    this.wanted = false;
    this.clearRetry();
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close();
    } catch {
      /* already gone */
    }
    this.state('disconnected');
  }

  send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== 1) {
      // Throwing rather than dropping: the caller queues markers to disk, and a
      // silent no-op here would lose a delivery instead of delaying it.
      throw new Error('control channel is not open');
    }
    this.socket.send(JSON.stringify(message));
  }

  /* ---------- internals ---------- */

  private open(): void {
    if (!this.wanted || this.socket) return;
    this.state(this.attempt === 0 ? 'connecting' : 'reconnecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch (e) {
      log.warn('link', 'could not open the control channel', { error: String(e) });
      this.scheduleRetry();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      log.info('link', `connected to ${this.host}`);
      this.state('connected');
    };

    socket.onmessage = (event) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(event.data));
      } catch {
        log.warn('link', 'ignoring a message that was not JSON');
        return;
      }
      const message = parseServerMessage(raw);
      if (!message) {
        // Unknown types are ignored, never errors. That rule is what lets the
        // vest and the phone be upgraded independently.
        log.debug('link', 'ignoring an unrecognised message');
        return;
      }
      this.deliver(message);
    };

    socket.onerror = () => {
      // Details are not available on React Native's WebSocket; onclose follows.
      log.debug('link', 'control channel error');
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (!this.wanted) return;
      log.warn('link', 'control channel closed, reconnecting');
      this.state('reconnecting');
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    this.clearRetry();
    const wait = this.backoffMs[Math.min(this.attempt, this.backoffMs.length - 1)] ?? 10_000;
    this.attempt += 1;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.open();
    }, wait);
  }

  private clearRetry(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }

  private deliver(message: ServerMessage): void {
    this.handlers?.onMessage(message);
  }

  private state(next: ConnectionState): void {
    this.handlers?.onState(next);
  }
}
