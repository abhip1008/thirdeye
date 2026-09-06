import { defaults } from '@/config/appConfig';
import { rawDb } from '@/db/queries';
import { log, redact } from '@/lib/log';

/**
 * The audit trail.
 *
 * Third Eye deletes almost everything it records, which is the point, but a
 * system that deletes evidence needs to be able to say what it deleted and
 * when. These rows are the answer to "what happened to that clip" without
 * keeping the clip. They are small, they carry no video, and they are the
 * only thing that outlives a match by design.
 *
 * Append-only from the app's point of view: nothing updates a row, and the
 * only deletion is the size-bound sweep below.
 */

export type AuditEventType =
  | 'match.started'
  | 'match.ended'
  | 'clip.announced'
  | 'clip.ready'
  | 'clip.failed'
  | 'clip.pinned'
  | 'clip.unpinned'
  | 'clip.reviewed'
  | 'clip.purged.ring'
  | 'clip.purged.expiry'
  | 'clip.purged.manual'
  | 'review.recorded'
  | 'privacy.notice.shown'
  | 'privacy.wipe.all'
  | 'pairing.stored'
  | 'pairing.forgotten';

export async function audit(
  type: AuditEventType,
  matchId: string | null,
  payload?: Record<string, unknown>
): Promise<void> {
  try {
    const db = await rawDb();
    await db.runAsync(
      'INSERT INTO events (match_id, ts, type, payload) VALUES (?, ?, ?, ?)',
      matchId,
      Date.now() / 1000,
      type,
      payload ? JSON.stringify(redact(payload)) : null
    );
  } catch (e) {
    // An audit write must never break the thing it is auditing.
    log.warn('audit', `could not record ${type}`, { error: String(e) });
  }
}

export interface AuditRow {
  id: number;
  matchId: string | null;
  ts: number;
  type: string;
  payload: string | null;
}

export async function recentAudit(limit = 200): Promise<AuditRow[]> {
  const db = await rawDb();
  const rows = await db.getAllAsync<{
    id: number; match_id: string | null; ts: number; type: string; payload: string | null;
  }>('SELECT * FROM events ORDER BY ts DESC LIMIT ?', limit);
  return rows.map((r) => ({
    id: r.id, matchId: r.match_id, ts: r.ts, type: r.type, payload: r.payload,
  }));
}

/** Keeps the log bounded. Runs on app start, alongside the retention sweep. */
export async function trimAuditLog(): Promise<number> {
  const db = await rawDb();
  const res = await db.runAsync(
    `DELETE FROM events WHERE id NOT IN (
       SELECT id FROM events ORDER BY ts DESC LIMIT ?
     )`,
    defaults.auditLogMaxRows
  );
  if (res.changes > 0) log.debug('audit', `trimmed ${res.changes} old audit rows`);
  return res.changes;
}
