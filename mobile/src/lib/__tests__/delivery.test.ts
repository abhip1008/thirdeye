import {
  DEBOUNCE_SECONDS,
  checkTimeout,
  elapsed,
  initialDelivery,
  isRecoverable,
  press,
  type DeliveryContext,
} from '../delivery';

/**
 * The delivery state machine is now the only thing that decides when a ball
 * started and stopped. Under the old design a physical remote did this and the
 * vest owned the logic; getting it wrong here means clips with the wrong
 * boundaries, which is worse than no clip at all because it looks fine.
 */

const T = 1_757_193_000;

describe('marking a delivery', () => {
  it('starts a new delivery on the first tap', () => {
    const { next, actions } = press(initialDelivery(), T);
    expect(next.state).toBe('recording');
    expect(next.seq).toBe(1);
    expect(actions).toEqual([{ type: 'mark', seq: 1, edge: 'start', at: T }]);
  });

  it('ends it on the second tap, under the same delivery number', () => {
    const started = press(initialDelivery(), T).next;
    const { next, actions } = press(started, T + 14);
    expect(next.state).toBe('idle');
    expect(next.seq).toBe(1);
    expect(actions).toEqual([{ type: 'mark', seq: 1, edge: 'end', at: T + 14 }]);
  });

  it('counts deliveries upward across balls', () => {
    let ctx: DeliveryContext = initialDelivery();
    for (let ball = 1; ball <= 6; ball++) {
      ctx = press(ctx, T + ball * 40).next;
      ctx = press(ctx, T + ball * 40 + 14).next;
    }
    expect(ctx.seq).toBe(6);
    expect(ctx.state).toBe('idle');
  });

  it('numbers wides and no-balls too, because deliveries are counted, not legal balls', () => {
    let ctx = press(initialDelivery(), T).next;
    ctx = press(ctx, T + 10).next;
    ctx = press(ctx, T + 50).next;
    expect(ctx.seq).toBe(2);
  });
});

describe('debounce', () => {
  it('ignores a second tap inside the window', () => {
    const started = press(initialDelivery(), T).next;
    const { next, actions } = press(started, T + DEBOUNCE_SECONDS - 0.1);
    expect(actions).toEqual([{ type: 'ignored', reason: 'debounce' }]);
    expect(next).toBe(started);
  });

  it('accepts a tap just past it', () => {
    const started = press(initialDelivery(), T).next;
    const { actions } = press(started, T + DEBOUNCE_SECONDS + 0.1);
    expect(actions[0]).toMatchObject({ type: 'mark', edge: 'end' });
  });

  it('does not let a bounce burn a delivery number', () => {
    const started = press(initialDelivery(), T).next;
    const bounced = press(started, T + 0.05).next;
    expect(bounced.seq).toBe(1);
  });
});

describe('the timeout', () => {
  it('leaves an open delivery alone before 40 seconds', () => {
    const started = press(initialDelivery(), T).next;
    expect(checkTimeout(started, T + 39, 40).actions).toEqual([]);
  });

  it('closes one nobody ended, stamped at the timeout rather than now', () => {
    const started = press(initialDelivery(), T).next;
    const { next, actions } = checkTimeout(started, T + 55, 40);
    expect(next.state).toBe('idle');
    // The clip ends where the timeout fell, not whenever the timer happened to
    // fire - otherwise a slow tick silently lengthens the clip.
    expect(actions).toEqual([{ type: 'mark', seq: 1, edge: 'end', at: T + 40 }]);
  });

  it('does nothing when idle', () => {
    expect(checkTimeout(initialDelivery(), T + 999, 40).actions).toEqual([]);
  });

  /* The one real cost of a single toggle: a forgotten END reads as a START.
     The timeout is what recovers it, so the next tap starts cleanly. */
  it('lets the next tap start a fresh delivery after a forgotten end', () => {
    const started = press(initialDelivery(), T).next;
    const closed = checkTimeout(started, T + 41, 40).next;
    const { next, actions } = press(closed, T + 60);
    expect(next.state).toBe('recording');
    expect(next.seq).toBe(2);
    expect(actions).toEqual([{ type: 'mark', seq: 2, edge: 'start', at: T + 60 }]);
  });
});

describe('the read-out', () => {
  it('reports zero when idle', () => {
    expect(elapsed(initialDelivery(), T)).toBe(0);
  });

  it('counts up while a delivery is open', () => {
    const started = press(initialDelivery(), T).next;
    expect(elapsed(started, T + 12.5)).toBe(12.5);
  });

  it('never goes negative if the clock offset shifts backwards', () => {
    const started = press(initialDelivery(), T).next;
    expect(elapsed(started, T - 5)).toBe(0);
  });
});

describe('whether a held marker is still worth sending', () => {
  /* The vest records into a rolling buffer. A marker outlives its footage, and
     the phone should say so rather than queue a request that will be refused. */
  it('is recoverable inside the buffer', () => {
    expect(isRecoverable(T, T + 120, 300)).toBe(true);
  });

  it('is not, once the footage has been overwritten', () => {
    expect(isRecoverable(T, T + 301, 300)).toBe(false);
  });
});
