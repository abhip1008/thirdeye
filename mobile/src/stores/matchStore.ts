import { create } from 'zustand';

import * as q from '@/db/queries';
import { log } from '@/lib/log';
import { audit } from '@/privacy/audit';
import type { Match } from '@/types/clip';
import type { UmpireEnd } from '@/types/protocol';

const BALLS_PER_OVER = 6;

interface MatchStore {
  match: Match | null;
  /** Over and ball are the phone's bookkeeping. The vest has no idea of score. */
  over: number;
  ballInOver: number;
  deliveryCount: number;

  hydrate: () => Promise<void>;
  startMatch: (input: {
    name: string;
    venue: string;
    cameraId: string;
    umpireEnd: UmpireEnd;
    ringSize: number;
  }) => Promise<Match>;
  endMatch: () => Promise<void>;
  /** A delivery began. Called when the vest enters `recording`. */
  countDelivery: (legal?: boolean) => void;
  setOverBall: (over: number, ballInOver: number) => void;
  resetOver: () => void;
}

/**
 * `2026-09-06-marymoor`. Deliberately built from a date and a venue and nothing
 * else: no team names, no player names, no umpire name. A match id ends up in
 * file paths and audit rows, and those outlive the video.
 */
function mintMatchId(venue: string, at: Date): string {
  const date = at.toISOString().slice(0, 10);
  const slug = venue.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug ? `${date}-${slug}` : date;
}

export const useMatch = create<MatchStore>((set, get) => ({
  match: null,
  over: 0,
  ballInOver: 0,
  deliveryCount: 0,

  hydrate: async () => {
    const open = await q.getOpenMatch();
    if (open) {
      const clips = await q.listClips(open.id);
      const latest = clips[0];
      set({
        match: open,
        deliveryCount: latest?.seq ?? 0,
        over: latest?.over ?? 0,
        ballInOver: latest?.ball_in_over ?? 0,
      });
      log.info('match', `resumed ${open.id}`);
    }
  },

  startMatch: async ({ name, venue, cameraId, umpireEnd, ringSize }) => {
    const now = new Date();
    const match: Match = {
      id: mintMatchId(venue, now),
      name: name.trim() || venue.trim() || 'Match',
      venue: venue.trim() || null,
      cameraId,
      umpireEnd,
      ringSize,
      startedAt: now.getTime() / 1000,
      endedAt: null,
      syncedAt: null,
    };
    await q.insertMatch(match);
    await audit('match.started', match.id, { venue: match.venue, camera_id: cameraId, ringSize });
    set({ match, over: 0, ballInOver: 0, deliveryCount: 0 });
    log.info('match', `started ${match.id}`);
    return match;
  },

  endMatch: async () => {
    const { match } = get();
    if (!match) return;
    const at = Date.now() / 1000;
    await q.endMatch(match.id, at);
    await audit('match.ended', match.id, { deliveries: get().deliveryCount });
    set({ match: { ...match, endedAt: at } });
    log.info('match', `ended ${match.id}`);
  },

  countDelivery: (legal = true) => {
    const { over, ballInOver, deliveryCount } = get();
    if (!legal) {
      set({ deliveryCount: deliveryCount + 1 });
      return;
    }
    const nextBall = ballInOver + 1;
    set(
      nextBall > BALLS_PER_OVER
        ? { over: over + 1, ballInOver: 1, deliveryCount: deliveryCount + 1 }
        : { ballInOver: nextBall, deliveryCount: deliveryCount + 1 }
    );
  },

  setOverBall: (over, ballInOver) =>
    set({
      over: Math.max(0, Math.trunc(over)),
      ballInOver: Math.min(BALLS_PER_OVER, Math.max(0, Math.trunc(ballInOver))),
    }),

  resetOver: () => set({ ballInOver: 0 }),
}));
