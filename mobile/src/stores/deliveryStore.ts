import { create } from 'zustand';

import * as q from '@/db/queries';
import {
  checkTimeout,
  initialDelivery,
  press as pressRule,
  type DeliveryAction,
  type DeliveryContext,
} from '@/lib/delivery';
import { isRecoverable } from '@/lib/delivery';
import { log } from '@/lib/log';
import { audit } from '@/privacy/audit';
import { PROTOCOL_VERSION } from '@/types/protocol';

import { useConnection } from './connectionStore';
import { useMatch } from './matchStore';
import { useSettings } from './settingsStore';

/**
 * The umpire's control, and the queue behind it.
 *
 * Every tap does two things: it updates the local state machine, and it writes
 * a marker to the database. Sending that marker to the vest is a third,
 * separate step that is allowed to fail.
 *
 * That separation is the whole design. The vest records continuously, so the
 * footage is never conditional on a message arriving - which means a marker
 * that cannot be delivered right now is not a lost ball, just a late one. The
 * phone holds it, retries on reconnect, and the clip turns up minutes after the
 * delivery instead of never.
 *
 * The write happens before the send, and to disk rather than to memory, because
 * the app being killed mid-over is an ordinary event.
 */

interface DeliveryStore {
  ctx: DeliveryContext;
  /** Markers written but not yet acknowledged by the vest. */
  queued: number;
  /** Markers dropped because their footage aged out of the vest's buffer. */
  abandoned: number;
  busy: boolean;

  hydrate: (matchId: string) => Promise<void>;
  press: () => Promise<void>;
  tick: () => Promise<void>;
  flush: () => Promise<void>;
  reset: () => void;
}

export const useDelivery = create<DeliveryStore>((set, get) => ({
  ctx: initialDelivery(),
  queued: 0,
  abandoned: 0,
  busy: false,

  hydrate: async (matchId) => {
    const seq = await q.highestMarkerSeq(matchId);
    const pending = await q.unsentMarkers(matchId);
    // Always resume idle. An app that was killed mid-delivery cannot know
    // whether the ball is still live, and showing RECORDING when it is not is
    // worse than making the umpire tap once more.
    set({ ctx: initialDelivery(seq), queued: pending.length });
    log.info('delivery', `resumed at delivery ${seq}, ${pending.length} marker(s) queued`);
  },

  press: async () => {
    const match = useMatch.getState().match;
    if (!match || get().busy) return;

    const at = useConnection.getState().vestNow();
    const { next, actions } = pressRule(get().ctx, at);

    if (actions[0]?.type === 'ignored') {
      log.debug('delivery', 'tap ignored, inside the debounce window');
      return;
    }

    set({ ctx: next, busy: true });
    try {
      await record(match.id, actions);
    } finally {
      set({ busy: false });
    }
    await get().flush();
  },

  /** Called on a timer while a delivery is open. */
  tick: async () => {
    const match = useMatch.getState().match;
    if (!match) return;
    const { ctx } = get();
    if (ctx.state !== 'recording') return;

    const timeout = useSettings.getState().timeoutSeconds;
    const { next, actions } = checkTimeout(ctx, useConnection.getState().vestNow(), timeout);
    if (actions.length === 0) return;

    log.warn('delivery', `delivery ${ctx.seq} closed itself after ${timeout}s`);
    set({ ctx: next });
    await record(match.id, actions);
    await get().flush();
  },

  /**
   * Push everything the vest has not acknowledged, oldest first.
   *
   * Order matters: a burst replayed after an outage has to arrive as start,
   * end, start, end. Anything whose footage has aged out of the buffer is
   * abandoned rather than sent, because a marker the vest will refuse is worse
   * than one the phone admits it lost.
   */
  flush: async () => {
    const match = useMatch.getState().match;
    if (!match) return;

    const connection = useConnection.getState();
    const pending = await q.unsentMarkers(match.id);
    if (pending.length === 0) {
      set({ queued: 0 });
      return;
    }

    const bufferSeconds = connection.bufferSeconds;
    const now = connection.vestNow();
    let abandoned = get().abandoned;

    for (const marker of pending) {
      if (bufferSeconds !== null && !isRecoverable(marker.at, now, bufferSeconds)) {
        await q.abandonMarker(marker.id);
        await audit('delivery.abandoned', match.id, {
          seq: marker.seq, edge: marker.edge, held_for_s: Math.round(now - marker.at),
        });
        abandoned += 1;
        log.warn('delivery', `marker ${marker.seq}/${marker.edge} outlived the vest buffer`);
        continue;
      }

      const sent = connection.send({
        v: PROTOCOL_VERSION,
        type: 'mark',
        seq: marker.seq,
        edge: marker.edge,
        at: marker.at,
        queued: marker.attempts > 0,
      });

      if (!sent) {
        await q.noteMarkerAttempt(marker.id);
        break; // keep the order; try again on the next flush
      }
      await q.markMarkerSent(marker.id);
    }

    const left = await q.unsentMarkers(match.id);
    set({ queued: left.length, abandoned });
  },

  reset: () => set({ ctx: initialDelivery(), queued: 0, abandoned: 0, busy: false }),
}));

/** Write first, then let the caller try to send. */
async function record(matchId: string, actions: DeliveryAction[]) {
  for (const action of actions) {
    if (action.type !== 'mark') continue;
    await q.insertMarker(matchId, action.seq, action.edge, action.at);
    await audit('delivery.marked', matchId, { seq: action.seq, edge: action.edge });
    if (action.edge === 'start') useMatch.getState().countDelivery();
  }
}
