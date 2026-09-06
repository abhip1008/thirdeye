import * as SQLite from 'expo-sqlite';

import { log } from '@/lib/log';

import { LATEST_VERSION, migrations } from './migrations';

const DB_NAME = 'thirdeye.db';

let handle: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Opens the database and brings it up to the latest schema version.
 * Safe to call repeatedly and from several places at once; the work happens
 * exactly once.
 */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (handle) return Promise.resolve(handle);
  if (opening) return opening;

  opening = (async () => {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    await migrate(db);
    handle = db;
    return db;
  })();

  return opening;
}

async function migrate(db: SQLite.SQLiteDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const from = row?.user_version ?? 0;
  if (from >= LATEST_VERSION) {
    log.debug('db', `schema at v${from}`);
    return;
  }

  for (const m of migrations) {
    if (m.version <= from) continue;
    log.info('db', `migrating to v${m.version} (${m.name})`);
    // execAsync runs the whole script in one implicit transaction, and
    // user_version is bumped inside it, so a failure part-way leaves the
    // database at the previous version rather than half-migrated.
    await db.execAsync(`BEGIN; ${m.sql} PRAGMA user_version = ${m.version}; COMMIT;`);
  }
  log.info('db', `schema now v${LATEST_VERSION}`);
}

/** Drops every row in every table. Used by "Delete all match data". */
export async function wipeAllData(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    BEGIN;
    DELETE FROM reviews;
    DELETE FROM clips;
    DELETE FROM matches;
    DELETE FROM events;
    COMMIT;
  `);
  log.warn('db', 'all local data deleted at user request');
}

/** Test seam: lets a test point the module at a fresh in-memory database. */
export function __setDbForTests(db: SQLite.SQLiteDatabase | null) {
  handle = db;
  opening = null;
}
