import { defaults } from '@/config/appConfig';
import { deleteClip, listClips, upsertClip } from '@/db/queries';
import { log } from '@/lib/log';
import type { Clip } from '@/types/clip';
import type { PinReason } from '@/types/protocol';

import { audit } from './audit';
import { isPhantom, pinExpiryFrom, purgeReason, shouldPurge } from './rules';
import { clipFileExists, deleteAllMatchFiles, deleteClipFiles } from './storage';

/**
 * Retention is a promise, so it is enforced here and only here.
 *
 * Three rules, in priority order:
 *
 *   1. A clip past its `purge_after` is deleted. No exception, pinned or not.
 *      A pin buys a clip more time, it does not buy it forever.
 *   2. A clip more than `ringSize` deliveries behind the newest is deleted
 *      unless it is pinned or has been reviewed.
 *   3. Deleting a clip means deleting its file, its partial file, and its row.
 *      A row without a file is a lie to the umpire; a file without a row is
 *      data nobody can see and nobody will ever delete.
 *
 * The sweep runs on app start, on every clip that arrives, and on demand from
 * the settings screen. It does not need the vest to be reachable: if the phone
 * never hears from the vest again, the clips still expire on schedule.
 */

export interface PurgeResult {
  deleted: number;
  bytesFreed: number;
}

export { pinExpiryFrom } from './rules';

export async function sweep(
  matchId: string,
  ringSize: number = defaults.ringSize,
  now: number = Date.now() / 1000
): Promise<PurgeResult> {
  const all = await listClips(matchId);
  const newestSeq = all.length ? Math.max(...all.map((c) => c.seq)) : 0;
  const doomed = all.filter((c) => shouldPurge(c, newestSeq, ringSize, now));
  let bytesFreed = 0;

  for (const clip of doomed) {
    bytesFreed += deleteClipFiles(clip.match_id, clip.camera_id, clip.seq);
    await deleteClip(clip.match_id, clip.camera_id, clip.seq);
    await audit(purgeReason(clip, now), matchId, {
      camera_id: clip.camera_id,
      seq: clip.seq,
      was_pinned: clip.pinned,
      was_reviewed: clip.reviewed,
    });
  }

  if (doomed.length) {
    log.info('retention', `purged ${doomed.length} clip(s)`, { bytesFreed });
  }
  return { deleted: doomed.length, bytesFreed };
}

/**
 * Brings the list back in line with what is actually on disk.
 *
 * Runs on hydrate, before a single row is shown. On iOS the operating system
 * can reclaim the cache directory between launches, and on any platform a
 * half-finished delete leaves a row without a file. Either way the umpire must
 * not be told a clip is ready when it is not: the row is downgraded so the dot
 * goes grey and the reason is written where they can read it.
 */
export async function reconcile(matchId: string): Promise<number> {
  const clips = await listClips(matchId);
  let corrected = 0;

  for (const clip of clips) {
    if (!isPhantom(clip, clipFileExists(clip.localPath))) continue;
    // The thumbnail goes with it. A still frame beside a row that says "not
    // here" says the opposite of the row, and the row is the one that is true.
    deleteClipFiles(clip.match_id, clip.camera_id, clip.seq);
    await upsertClip({
      ...clip,
      status: 'failed',
      localPath: null,
      thumbPath: null,
      bytesLocal: 0,
      lastError: 'The phone freed up space and removed it',
    });
    await audit('clip.failed', matchId, {
      camera_id: clip.camera_id, seq: clip.seq, reason: 'file missing on disk',
    });
    corrected++;
  }

  if (corrected) log.warn('retention', `${corrected} clip(s) had lost their files`);
  return corrected;
}

/** Pin a clip, which sets an explicit expiry rather than removing one. */
export async function pin(
  clip: Clip,
  reason: PinReason,
  retentionDays: number = defaults.pinRetentionDays
): Promise<Clip> {
  const now = Date.now() / 1000;
  const next: Clip = {
    ...clip,
    pinned: true,
    pinReason: reason,
    pinnedAt: now,
    purgeAfter: pinExpiryFrom(now, retentionDays),
  };
  await upsertClip(next);
  await audit('clip.pinned', clip.match_id, {
    camera_id: clip.camera_id, seq: clip.seq, reason, expires_in_days: retentionDays,
  });
  return next;
}

export async function unpin(clip: Clip): Promise<Clip> {
  const next: Clip = { ...clip, pinned: false, pinReason: null, pinnedAt: null, purgeAfter: null };
  await upsertClip(next);
  await audit('clip.unpinned', clip.match_id, { camera_id: clip.camera_id, seq: clip.seq });
  return next;
}

/**
 * End-of-match purge. Everything unpinned goes immediately rather than waiting
 * for the ring to roll, because after the match there are no more deliveries
 * to roll it.
 */
export async function purgeUnpinned(matchId: string): Promise<PurgeResult> {
  return sweep(matchId, 0);
}

/** The nuclear option, offered in settings. Files first, then rows. */
export async function purgeEverything(): Promise<void> {
  deleteAllMatchFiles();
  const { clearFootage } = await import('./footage');
  clearFootage();
  const { wipeAllData } = await import('@/db/client');
  await wipeAllData();
  // Audited after the wipe so the record of the wipe survives it.
  await audit('privacy.wipe.all', null, { at: new Date().toISOString() });
}
