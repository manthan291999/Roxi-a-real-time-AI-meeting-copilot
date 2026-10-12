/**
 * AI Meeting Interpreter — SQLite Migrations
 *
 * Forward-only, transactional migration runner (blueprint §4.2–4.3).
 * Rules:
 *  - Extend-only: never rename or drop tables/columns (Rust db.rs compat).
 *  - Each migration runs in its own transaction and records itself in
 *    schema_version; a failure aborts startup (caller surfaces an Error event).
 *  - Base tables are created with CREATE TABLE IF NOT EXISTS in db.js, so a
 *    fresh DB bootstraps without replaying history.
 */

const { log } = require('../infrastructure/logger.js');

const MIGRATIONS = [
  {
    version: 1,
    description: 'M001 extend meetings (end_time, context, status, api_calls, provider)',
    statements: [
      'ALTER TABLE meetings ADD COLUMN end_time DATETIME',
      'ALTER TABLE meetings ADD COLUMN context TEXT',
      "ALTER TABLE meetings ADD COLUMN status TEXT NOT NULL DEFAULT 'running'",
      'ALTER TABLE meetings ADD COLUMN api_calls INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE meetings ADD COLUMN provider TEXT',
    ],
  },
  {
    version: 2,
    description: 'M002 chunks (analyzed transcript chunks with significance)',
    statements: [
      `CREATE TABLE chunks (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id   INTEGER NOT NULL REFERENCES meetings(id),
        seq          INTEGER NOT NULL,
        speaker      TEXT,
        text         TEXT NOT NULL,
        significance TEXT,
        topic        TEXT,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (meeting_id, seq)
      )`,
      'CREATE INDEX idx_chunks_meeting ON chunks (meeting_id, seq)',
    ],
  },
  {
    version: 3,
    description: 'M003 speaker_profiles',
    statements: [
      `CREATE TABLE speaker_profiles (
        meeting_id   INTEGER NOT NULL REFERENCES meetings(id),
        speaker      TEXT NOT NULL,
        chunk_count  INTEGER NOT NULL DEFAULT 0,
        topics       TEXT,
        last_seen    DATETIME,
        PRIMARY KEY (meeting_id, speaker)
      )`,
    ],
  },
  {
    version: 4,
    description: 'M004 glossary_terms',
    statements: [
      `CREATE TABLE glossary_terms (
        meeting_id   INTEGER NOT NULL REFERENCES meetings(id),
        term         TEXT NOT NULL,
        definition   TEXT,
        first_seen   DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (meeting_id, term)
      )`,
    ],
  },
  {
    version: 5,
    description: 'M005 risks (previously emitted but never persisted)',
    statements: [
      `CREATE TABLE risks (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id   INTEGER NOT NULL REFERENCES meetings(id),
        chunk_id     INTEGER REFERENCES chunks(id),
        text         TEXT NOT NULL,
        category     TEXT,
        severity     TEXT,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      'CREATE INDEX idx_risks_meeting ON risks (meeting_id)',
    ],
  },
  {
    version: 6,
    description: 'M006 extend decisions (confidence, chunk_id) and action_items (deadline, chunk_id)',
    statements: [
      'ALTER TABLE decisions ADD COLUMN confidence REAL',
      'ALTER TABLE decisions ADD COLUMN chunk_id INTEGER REFERENCES chunks(id)',
      'ALTER TABLE action_items ADD COLUMN deadline TEXT',
      'ALTER TABLE action_items ADD COLUMN chunk_id INTEGER REFERENCES chunks(id)',
    ],
  },
  {
    version: 7,
    description: 'M007 summaries (kind-tagged; meetings.summary kept for Rust compat)',
    statements: [
      `CREATE TABLE summaries (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id   INTEGER NOT NULL REFERENCES meetings(id),
        kind         TEXT NOT NULL DEFAULT 'executive',
        text         TEXT NOT NULL,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
    ],
  },
  {
    version: 8,
    description: 'M008 projects + project scoping on meetings',
    statements: [
      // IF NOT EXISTS, unlike every migration above it, because the Rust host
      // also ensures this one table: the project picker runs before the first
      // capture ever happens, so on a fresh install there is no sidecar to have
      // applied this migration yet and "+ New project" would have nothing to
      // insert into. Kept byte-equivalent to `ensureProjects` in
      // src-tauri/src/adapters/sqlite_schema.rs — change them together.
      //
      // The `meetings` columns below have no such counterpart: `project_seq`
      // must be MAX + 1 inside the same transaction as the meeting insert, so
      // only the writer of that row can assign it, and that writer is here.
      `CREATE TABLE IF NOT EXISTS projects (
        project_id  INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        code        TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at TEXT
      )`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_name ON projects (name)',

      // Surrogate key stays `meetings.id`: every FK in the database already
      // points at it, so a composite or hierarchical key would ripple through
      // transcripts, chunks, decisions, action_items, risks, summaries and
      // speaker_* for no benefit. `display_id` is the human identity instead.
      'ALTER TABLE meetings ADD COLUMN project_id INTEGER REFERENCES projects(project_id)',
      'ALTER TABLE meetings ADD COLUMN project_seq INTEGER',
      'ALTER TABLE meetings ADD COLUMN display_id TEXT',
      'CREATE INDEX IF NOT EXISTS idx_meetings_project ON meetings (project_id, start_time DESC)',

      // Backfill: every existing meeting lands in one bucket, nothing orphaned.
      // The row may already exist if the Rust host seeded it first.
      "INSERT INTO projects (name, code) SELECT 'Unsorted', 'GEN' WHERE NOT EXISTS (SELECT 1 FROM projects WHERE code = 'GEN')",
      "UPDATE meetings SET project_id = (SELECT project_id FROM projects WHERE code = 'GEN') WHERE project_id IS NULL",
    ],
  },
  {
    version: 9,
    description: 'M009 persist meeting role for post-hoc persona framing',
    statements: ['ALTER TABLE meetings ADD COLUMN role TEXT'],
  },
  {
    version: 10,
    description: 'M010 persist meeting name, asked for at capture start',
    statements: ['ALTER TABLE meetings ADD COLUMN name TEXT'],
  },
  {
    version: 11,
    description: 'M011 meeting owner account, so each signed-in account sees only its own history',
    // The Rust host adds the same column at launch (sqlite_schema.rs
    // ensure_meeting_owner) because it reads before any capture has run, so
    // this step must tolerate the column already being there.
    run: (db) => {
      if (!hasColumn(db, 'meetings', 'account_id')) {
        db.exec('ALTER TABLE meetings ADD COLUMN account_id TEXT');
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_meetings_account ON meetings (account_id, start_time DESC)');
    },
  },
];

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {boolean}
 */
function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

/**
 * Apply all pending migrations.
 * @param {import('better-sqlite3').Database} db
 * @returns {number} the schema version now in effect
 * @throws on any migration failure (transaction rolled back)
 */
function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version     INTEGER PRIMARY KEY,
    applied_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    description TEXT
  )`);

  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
  let current = (row && row.v) || 0;

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    const apply = db.transaction(() => {
      for (const sql of m.statements || []) db.exec(sql);
      if (m.run) m.run(db);
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(m.version, m.description);
    });
    apply();
    log('info', 'db', 'migration_applied', { version: m.version, description: m.description });
    current = m.version;
  }

  return current;
}

module.exports = { runMigrations, MIGRATIONS };
