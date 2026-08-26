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
];

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
      for (const sql of m.statements) db.exec(sql);
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(m.version, m.description);
    });
    apply();
    log('info', 'db', 'migration_applied', { version: m.version, description: m.description });
    current = m.version;
  }

  return current;
}

module.exports = { runMigrations, MIGRATIONS };
