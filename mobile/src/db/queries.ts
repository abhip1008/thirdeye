import type { SQLiteDatabase } from 'expo-sqlite';

import type { Clip, Match, Review } from '@/types/clip';
import type {
  AppealType,
  ClipStatus,
  Decision,
  MarkEdge,
  PinReason,
  UmpireEnd,
} from '@/types/protocol';

import { getDb } from './client';

/**
 * The only module that writes SQL. Stores and screens call these functions and
 * never see a query string, so the storage engine stays swappable and every
 * write that touches retention passes through one place that can be audited.
 */

interface ClipRow {
  match_id: string;
  camera_id: string;
  seq: number;
  over: number | null;
  ball_in_over: number | null;
  legal: number;
  started_at: number;
  ended_at: number;
  duration_s: number;
  preroll_s: number;
  resolution: string | null;
  fps: number | null;
  codec: string | null;
  bytes: number;
  sha256: string;
  closed_by: string;
  status: string;
  bytes_local: number;
  local_path: string | null;
  thumb_path: string | null;
  pinned: number;
  pin_reason: string | null;
  pinned_at: number | null;
  reviewed: number;
  downloaded_at: number | null;
  attempts: number;
  last_error: string | null;
  purge_after: number | null;
}

const toClip = (r: ClipRow): Clip => ({
  v: 1,
  match_id: r.match_id,
  camera_id: r.camera_id,
  seq: r.seq,
  over: r.over,
  ball_in_over: r.ball_in_over,
  legal: !!r.legal,
  started_at: r.started_at,
  ended_at: r.ended_at,
  duration_s: r.duration_s,
  preroll_s: r.preroll_s,
  resolution: r.resolution ?? '',
  fps: r.fps ?? 0,
  codec: r.codec ?? '',
  bytes: r.bytes,
  sha256: r.sha256,
  closed_by: r.closed_by as Clip['closed_by'],
  status: r.status as ClipStatus,
  bytesLocal: r.bytes_local,
  localPath: r.local_path,
  thumbPath: r.thumb_path,
  pinned: !!r.pinned,
  pinReason: (r.pin_reason as PinReason | null) ?? null,
  pinnedAt: r.pinned_at,
  purgeAfter: r.purge_after,
  reviewed: !!r.reviewed,
  downloadedAt: r.downloaded_at,
  attempts: r.attempts,
  lastError: r.last_error,
});

/* ---------- matches ---------- */

export async function insertMatch(m: Match): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO matches
       (id, name, venue, camera_id, umpire_end, ring_size, started_at, ended_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    m.id, m.name, m.venue, m.cameraId, m.umpireEnd, m.ringSize, m.startedAt, m.endedAt, m.syncedAt
  );
}

export async function endMatch(matchId: string, at: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE matches SET ended_at = ? WHERE id = ?', at, matchId);
}

export async function getMatch(matchId: string): Promise<Match | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{
    id: string; name: string; venue: string | null; camera_id: string;
    umpire_end: string | null; ring_size: number; started_at: number;
    ended_at: number | null; synced_at: number | null;
  }>('SELECT * FROM matches WHERE id = ?', matchId);
  if (!r) return null;
  return {
    id: r.id, name: r.name, venue: r.venue, cameraId: r.camera_id,
    umpireEnd: (r.umpire_end as UmpireEnd | null) ?? null, ringSize: r.ring_size,
    startedAt: r.started_at, endedAt: r.ended_at, syncedAt: r.synced_at,
  };
}

export async function getOpenMatch(): Promise<Match | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM matches WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1'
  );
  return r ? getMatch(r.id) : null;
}

/** Venue suggestions on the setup screen. Last five, most recent first. */
export async function recentVenues(limit = 5): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ venue: string }>(
    `SELECT venue, MAX(started_at) AS last_used FROM matches
     WHERE venue IS NOT NULL AND venue <> ''
     GROUP BY venue ORDER BY last_used DESC LIMIT ?`,
    limit
  );
  return rows.map((r) => r.venue);
}

/* ---------- clips ---------- */

export async function upsertClip(c: Clip): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO clips
       (match_id, camera_id, seq, over, ball_in_over, legal, started_at, ended_at,
        duration_s, preroll_s, resolution, fps, codec, bytes, sha256, closed_by,
        status, bytes_local, local_path, thumb_path, pinned, pin_reason, pinned_at,
        reviewed, downloaded_at, attempts, last_error, purge_after)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     -- Every column except the key. A field left out of this list can be set
     -- once and never changed again, and the write that tries looks like it
     -- worked: no error, no warning, just the old value still sitting there.
     -- That is how resolution stayed at the vest camera's default long after
     -- the app had measured the real one.
     ON CONFLICT(match_id, camera_id, seq) DO UPDATE SET
       over=excluded.over, ball_in_over=excluded.ball_in_over, legal=excluded.legal,
       started_at=excluded.started_at, ended_at=excluded.ended_at,
       duration_s=excluded.duration_s, preroll_s=excluded.preroll_s,
       resolution=excluded.resolution, fps=excluded.fps, codec=excluded.codec,
       bytes=excluded.bytes, sha256=excluded.sha256,
       closed_by=excluded.closed_by, status=excluded.status,
       bytes_local=excluded.bytes_local, local_path=excluded.local_path,
       thumb_path=excluded.thumb_path, pinned=excluded.pinned,
       pin_reason=excluded.pin_reason, pinned_at=excluded.pinned_at,
       reviewed=excluded.reviewed, downloaded_at=excluded.downloaded_at,
       attempts=excluded.attempts, last_error=excluded.last_error,
       purge_after=excluded.purge_after`,
    c.match_id, c.camera_id, c.seq, c.over, c.ball_in_over, c.legal ? 1 : 0,
    c.started_at, c.ended_at, c.duration_s, c.preroll_s, c.resolution, c.fps, c.codec,
    c.bytes, c.sha256, c.closed_by, c.status, c.bytesLocal, c.localPath, c.thumbPath,
    c.pinned ? 1 : 0, c.pinReason, c.pinnedAt, c.reviewed ? 1 : 0, c.downloadedAt,
    c.attempts, c.lastError, c.purgeAfter
  );
}

export async function listClips(matchId: string): Promise<Clip[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ClipRow>(
    'SELECT * FROM clips WHERE match_id = ? ORDER BY seq DESC',
    matchId
  );
  return rows.map(toClip);
}

export async function getClip(
  matchId: string,
  cameraId: string,
  seq: number
): Promise<Clip | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<ClipRow>(
    'SELECT * FROM clips WHERE match_id = ? AND camera_id = ? AND seq = ?',
    matchId, cameraId, seq
  );
  return r ? toClip(r) : null;
}

export async function setClipStatus(
  matchId: string, cameraId: string, seq: number,
  status: ClipStatus, lastError: string | null = null
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE clips SET status = ?, last_error = ?
     WHERE match_id = ? AND camera_id = ? AND seq = ?`,
    status, lastError, matchId, cameraId, seq
  );
}

export async function setClipPin(
  matchId: string, cameraId: string, seq: number,
  pinned: boolean, reason: PinReason | null, purgeAfter: number | null
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE clips SET pinned = ?, pin_reason = ?, pinned_at = ?, purge_after = ?
     WHERE match_id = ? AND camera_id = ? AND seq = ?`,
    pinned ? 1 : 0, pinned ? reason : null, pinned ? Date.now() / 1000 : null,
    pinned ? purgeAfter : null, matchId, cameraId, seq
  );
}

export async function markReviewed(
  matchId: string, cameraId: string, seq: number
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE clips SET reviewed = 1 WHERE match_id = ? AND camera_id = ? AND seq = ?',
    matchId, cameraId, seq
  );
}

export async function deleteClip(
  matchId: string, cameraId: string, seq: number
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'DELETE FROM clips WHERE match_id = ? AND camera_id = ? AND seq = ?',
    matchId, cameraId, seq
  );
}

/* ---------- reviews ---------- */

export async function insertReview(r: Omit<Review, 'id'>): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync(
    `INSERT INTO reviews (match_id, camera_id, seq, called_at, appeal_type, decision, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    r.matchId, r.cameraId, r.seq, r.calledAt, r.appealType, r.decision, r.notes
  );
  return res.lastInsertRowId;
}

export async function listReviews(matchId: string): Promise<Review[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: number; match_id: string; camera_id: string; seq: number;
    called_at: number; appeal_type: string | null; decision: string | null; notes: string | null;
  }>('SELECT * FROM reviews WHERE match_id = ? ORDER BY called_at DESC', matchId);
  return rows.map((r) => ({
    id: r.id, matchId: r.match_id, cameraId: r.camera_id, seq: r.seq,
    calledAt: r.called_at, appealType: (r.appeal_type as AppealType | null) ?? null,
    decision: (r.decision as Decision | null) ?? null, notes: r.notes,
  }));
}

export async function reviewForClip(
  matchId: string, cameraId: string, seq: number
): Promise<Review | null> {
  const all = await listReviews(matchId);
  return all.find((r) => r.cameraId === cameraId && r.seq === seq) ?? null;
}

/* ---------- delivery markers ---------- */

export interface StoredMarker {
  id: number;
  matchId: string;
  seq: number;
  edge: MarkEdge;
  at: number;
  createdAt: number;
  attempts: number;
}

export async function insertMarker(
  matchId: string,
  seq: number,
  edge: MarkEdge,
  at: number
): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync(
    'INSERT INTO markers (match_id, seq, edge, at, created_at) VALUES (?, ?, ?, ?, ?)',
    matchId,
    seq,
    edge,
    at,
    Date.now() / 1000
  );
  return res.lastInsertRowId;
}

/** Everything the vest has not acknowledged, oldest first. Order matters: a
 *  burst replayed after an outage must arrive as start, end, start, end. */
export async function unsentMarkers(matchId: string): Promise<StoredMarker[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: number; match_id: string; seq: number; edge: string;
    at: number; created_at: number; attempts: number;
  }>(
    'SELECT * FROM markers WHERE match_id = ? AND sent = 0 ORDER BY id ASC',
    matchId
  );
  return rows.map((r) => ({
    id: r.id, matchId: r.match_id, seq: r.seq, edge: r.edge as MarkEdge,
    at: r.at, createdAt: r.created_at, attempts: r.attempts,
  }));
}

export async function markMarkerSent(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE markers SET sent = 1 WHERE id = ?', id);
}

export async function noteMarkerAttempt(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE markers SET attempts = attempts + 1 WHERE id = ?', id);
}

/** Give up on a marker whose footage the vest can no longer reach. */
export async function abandonMarker(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE markers SET sent = 1, attempts = attempts + 1 WHERE id = ?', id);
}

/** Highest delivery number this match has seen, so a restart resumes counting. */
export async function highestMarkerSeq(matchId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ top: number | null }>(
    'SELECT MAX(seq) AS top FROM markers WHERE match_id = ?',
    matchId
  );
  return row?.top ?? 0;
}

/* ---------- raw access for the audit module ---------- */

export const rawDb = (): Promise<SQLiteDatabase> => getDb();
