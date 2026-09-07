/**
 * Ordered, append-only migrations.
 *
 * Never edit a migration that has shipped; add a new one. The phone in an
 * umpire's pocket has a database created by whatever version they installed in
 * March, and the only safe way to reach the current shape from there is to
 * replay the list.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial',
    sql: `
      CREATE TABLE matches (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        venue       TEXT,
        camera_id   TEXT NOT NULL,
        umpire_end  TEXT,
        ring_size   INTEGER NOT NULL DEFAULT 12,
        started_at  REAL NOT NULL,
        ended_at    REAL,
        synced_at   REAL
      );

      -- Keyed by (match_id, camera_id, seq), not (match_id, seq).
      -- v1 runs one vest. A second unit at square leg produces a second stream
      -- of seq numbers that collide with the first, and discovering that after
      -- a season of data is far more expensive than carrying the column now.
      CREATE TABLE clips (
        match_id      TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        camera_id     TEXT NOT NULL,
        seq           INTEGER NOT NULL,
        over          INTEGER,
        ball_in_over  INTEGER,
        legal         INTEGER NOT NULL DEFAULT 1,
        started_at    REAL NOT NULL,
        ended_at      REAL NOT NULL,
        duration_s    REAL NOT NULL,
        preroll_s     REAL NOT NULL DEFAULT 0,
        resolution    TEXT,
        fps           REAL,
        codec         TEXT,
        bytes         INTEGER NOT NULL,
        sha256        TEXT NOT NULL,
        closed_by     TEXT NOT NULL,
        status        TEXT NOT NULL,
        bytes_local   INTEGER NOT NULL DEFAULT 0,
        local_path    TEXT,
        thumb_path    TEXT,
        pinned        INTEGER NOT NULL DEFAULT 0,
        pin_reason    TEXT,
        pinned_at     REAL,
        reviewed      INTEGER NOT NULL DEFAULT 0,
        downloaded_at REAL,
        attempts      INTEGER NOT NULL DEFAULT 0,
        last_error    TEXT,
        -- Every retained clip carries its own expiry instead of relying on a
        -- rule someone has to remember to apply. A row with purge_after in the
        -- past is deleted on the next sweep, whatever else is true about it.
        purge_after   REAL,
        PRIMARY KEY (match_id, camera_id, seq)
      );

      CREATE INDEX idx_clips_status ON clips(match_id, status);
      CREATE INDEX idx_clips_seq    ON clips(match_id, seq DESC);
      CREATE INDEX idx_clips_purge  ON clips(purge_after) WHERE purge_after IS NOT NULL;

      CREATE TABLE reviews (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id    TEXT NOT NULL,
        camera_id   TEXT NOT NULL,
        seq         INTEGER NOT NULL,
        called_at   REAL NOT NULL,
        appeal_type TEXT,
        decision    TEXT,
        notes       TEXT
      );

      CREATE INDEX idx_reviews_clip ON reviews(match_id, camera_id, seq);

      -- Append-only audit trail. Answers "what happened to that clip" without
      -- keeping the clip. Bounded by a sweep; see privacy/audit.ts.
      CREATE TABLE events (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id TEXT,
        ts       REAL NOT NULL,
        type     TEXT NOT NULL,
        payload  TEXT
      );

      CREATE INDEX idx_events_ts ON events(ts DESC);

      -- Small key/value table for user settings. Kept in the same database as
      -- everything else so that "delete all data" is one transaction and there
      -- is no second store to forget about.
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'delivery_markers',
    sql: `
      -- The umpire's taps, held on the phone until the vest has them.
      --
      -- This table is why a Wi-Fi outage is survivable. The vest records
      -- continuously, so footage is never conditional on a marker arriving;
      -- these rows are what let the phone replay an over's worth of markers
      -- once the link comes back and still get the clips.
      --
      -- Persisted rather than kept in memory because the app being killed
      -- mid-over is an ordinary event, not an exceptional one.
      CREATE TABLE markers (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id   TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        seq        INTEGER NOT NULL,
        edge       TEXT NOT NULL,          -- start | end
        at         REAL NOT NULL,          -- vest clock, offset already applied
        created_at REAL NOT NULL,          -- phone clock, for diagnostics only
        sent       INTEGER NOT NULL DEFAULT 0,
        attempts   INTEGER NOT NULL DEFAULT 0
      );

      -- The flush path reads exactly this, in order.
      CREATE INDEX idx_markers_unsent ON markers(match_id, sent, id);
    `,
  },
];

export const LATEST_VERSION = migrations[migrations.length - 1].version;
