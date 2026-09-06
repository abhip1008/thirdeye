import type { Clip } from '@/types/clip';

/**
 * The retention rules, as pure functions.
 *
 * These decide whether a piece of footage still exists. They are deliberately
 * free of the database, the filesystem and the network so that they can be read
 * in one sitting and tested without any of those - and so that there is exactly
 * one definition of the rule rather than one in TypeScript and a second one
 * hiding in a WHERE clause.
 */

/** Unix seconds at which a clip pinned at `now` should expire. */
export const pinExpiryFrom = (now: number, days: number): number => now + days * 86_400;

/**
 * Rule 1. Past its stated expiry, and therefore deleted whatever else is true
 * about it. A pin buys a clip time, it does not buy it forever.
 */
export const isPastExpiry = (clip: Clip, now: number): boolean =>
  clip.purgeAfter !== null && clip.purgeAfter <= now;

/** A clip the umpire has marked, or one that was used to make a decision. */
export const isProtected = (clip: Clip): boolean => clip.pinned || clip.reviewed;

/**
 * Rule 2. More than `ringSize` deliveries behind the newest clip. The window is
 * measured in deliveries rather than time, because the promise made to players
 * is "twelve balls", not "four minutes".
 */
export const isBeyondRing = (clip: Clip, newestSeq: number, ringSize: number): boolean =>
  clip.seq <= newestSeq - ringSize;

/** The whole decision, in the order the rules are stated in docs/PRIVACY.md. */
export function shouldPurge(
  clip: Clip,
  newestSeq: number,
  ringSize: number,
  now: number
): boolean {
  if (isPastExpiry(clip, now)) return true;
  if (isProtected(clip)) return false;
  return isBeyondRing(clip, newestSeq, ringSize);
}

/**
 * A clip whose row says ready but whose bytes are gone.
 *
 * iOS may reclaim the cache directory at any time, so a row can outlive its
 * file. This is the check that stops the list showing a green dot over a clip
 * that will not play, which is the one failure the status dot exists to
 * prevent.
 */
export const isPhantom = (clip: Clip, fileExists: boolean): boolean =>
  clip.status === 'ready' && !fileExists;

/** Why a clip is going, for the audit trail. */
export const purgeReason = (clip: Clip, now: number): 'clip.purged.expiry' | 'clip.purged.ring' =>
  isPastExpiry(clip, now) ? 'clip.purged.expiry' : 'clip.purged.ring';
