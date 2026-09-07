import type { MarkEdge } from '@/types/protocol';

/**
 * The delivery state machine, as pure functions.
 *
 * This replaced the two-button BLE remote, and it is now the only thing that
 * decides when a ball started and stopped. It is deliberately free of React,
 * the network and the clock, so the rules can be read in one sitting and tested
 * without a phone in the room.
 *
 * One control, not two. The umpire taps once when the bowler runs in and once
 * when the ball is dead, and the same button does both. A toggle cannot be
 * pressed in the wrong order, which matters more than it sounds: with two
 * buttons on a screen, a mis-tap in the wrong place produces a marker that says
 * the opposite of what happened.
 *
 * The cost of one control is that a forgotten END is indistinguishable from a
 * START. If the umpire forgets to end a ball and taps again as the next bowler
 * runs in, that tap reads as END. The timeout is what recovers it: the clip
 * auto-closes after 40 seconds, so the next tap starts cleanly. The delivery in
 * between is not lost either - the vest records continuously, so it can still
 * be grabbed out of the buffer.
 */

export type DeliveryState = 'idle' | 'recording';

export interface DeliveryContext {
  state: DeliveryState;
  /** Last delivery number used. The phone mints these; the vest does not count. */
  seq: number;
  /** Vest-clock seconds, or null when idle. */
  startedAt: number | null;
  /** Vest-clock seconds of the last accepted event, for debounce. */
  lastEventAt: number | null;
}

export type DeliveryAction =
  | { type: 'mark'; seq: number; edge: MarkEdge; at: number }
  | { type: 'ignored'; reason: 'debounce' };

export interface DeliveryResult {
  next: DeliveryContext;
  actions: DeliveryAction[];
}

export const initialDelivery = (seq = 0): DeliveryContext => ({
  state: 'idle',
  seq,
  startedAt: null,
  lastEventAt: null,
});

/**
 * Two seconds. A real START and END cannot be closer together than that, so
 * anything inside the window is a double-tap, a glove brushing the screen, or a
 * phone settling in a pocket.
 */
export const DEBOUNCE_SECONDS = 2;

/** The umpire tapped the control. `at` is in vest-clock seconds. */
export function press(ctx: DeliveryContext, at: number): DeliveryResult {
  if (ctx.lastEventAt !== null && at - ctx.lastEventAt < DEBOUNCE_SECONDS) {
    return { next: ctx, actions: [{ type: 'ignored', reason: 'debounce' }] };
  }

  if (ctx.state === 'idle') {
    const seq = ctx.seq + 1;
    return {
      next: { state: 'recording', seq, startedAt: at, lastEventAt: at },
      actions: [{ type: 'mark', seq, edge: 'start', at }],
    };
  }

  return {
    next: { state: 'idle', seq: ctx.seq, startedAt: null, lastEventAt: at },
    actions: [{ type: 'mark', seq: ctx.seq, edge: 'end', at }],
  };
}

/**
 * Called on a timer. Closes a delivery nobody ended.
 *
 * Forty seconds, not twenty-five. A legitimate live ball - run-up, delivery,
 * three runs, a throw and a settle - is about twenty-nine seconds, and a shorter
 * timeout truncates exactly the deliveries people argue about. A 40-second clip
 * still transfers inside the gap, so the cost of the longer window is nothing
 * and the cost of the shorter one is lost evidence.
 */
export function checkTimeout(
  ctx: DeliveryContext,
  now: number,
  timeoutSeconds: number
): DeliveryResult {
  if (ctx.state !== 'recording' || ctx.startedAt === null) {
    return { next: ctx, actions: [] };
  }
  if (now - ctx.startedAt < timeoutSeconds) {
    return { next: ctx, actions: [] };
  }
  return {
    next: { state: 'idle', seq: ctx.seq, startedAt: null, lastEventAt: now },
    actions: [{ type: 'mark', seq: ctx.seq, edge: 'end', at: ctx.startedAt + timeoutSeconds }],
  };
}

/** Seconds the current delivery has been open, for the control's read-out. */
export const elapsed = (ctx: DeliveryContext, now: number): number =>
  ctx.startedAt === null ? 0 : Math.max(0, now - ctx.startedAt);

/**
 * Whether a marker is still worth sending.
 *
 * The vest records into a rolling buffer, so a marker held through an outage is
 * only useful while the footage it points at still exists. Past that, the phone
 * should say so rather than queue a request that will be refused.
 */
export const isRecoverable = (markAt: number, now: number, bufferSeconds: number): boolean =>
  now - markAt < bufferSeconds;
