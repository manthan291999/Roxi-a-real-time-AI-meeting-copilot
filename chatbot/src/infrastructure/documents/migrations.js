/**
 * Document store migrations — forward-only, transactional.
 *
 * Mirrors the convention in gateway/db/migrate.js: each migration runs in its
 * own transaction and records itself in schema_version. Never edit a shipped
 * migration; add a new one.
 *
 * This is a SEPARATE database file from chat_index.db. chat_index.db is opened
 * read-only by FtsRetriever and wholesale-rebuilt by FtsIndexBuilder, so
 * putting user documents there would tie their lifetime to an index rebuild. A
 * separate file also means the whole document feature is deletable in one move.
 */

'use strict';

const MIGRATIONS = [
  {
    version: 1,
    description: 'D001 documents + document_chunks (embedded passages)',
    statements: [
      `CREATE TABLE documents (
        doc_id        TEXT PRIMARY KEY,
        file_name     TEXT NOT NULL,
        mime_type     TEXT NOT NULL,
        byte_size     INTEGER NOT NULL,
        page_count    INTEGER,
        chunk_count   INTEGER NOT NULL DEFAULT 0,
        embed_model   TEXT NOT NULL,
        dimensions    INTEGER NOT NULL,
        status        TEXT NOT NULL,
        error_message TEXT,
        uploaded_at   TEXT NOT NULL,
        content_hash  TEXT NOT NULL,
        meeting_id    INTEGER
      )`,

      // sha256 of the file bytes: re-uploading the same file is a no-op rather
      // than a second copy with a second embedding bill.
      'CREATE UNIQUE INDEX idx_docs_hash ON documents (content_hash)',

      // Reserved for optional per-meeting scoping. Nullable and unread today —
      // documents are global — but present so adding a scope filter later
      // needs no migration.
      'CREATE INDEX idx_docs_meeting ON documents (meeting_id)',

      `CREATE TABLE document_chunks (
        chunk_id    TEXT PRIMARY KEY,
        doc_id      TEXT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        page_number INTEGER,
        char_start  INTEGER NOT NULL,
        char_end    INTEGER NOT NULL,
        text        TEXT NOT NULL,
        embedding   BLOB NOT NULL
      )`,

      'CREATE INDEX idx_chunks_doc ON document_chunks (doc_id)',
      'CREATE UNIQUE INDEX idx_chunks_doc_seq ON document_chunks (doc_id, chunk_index)',
    ],
  },
];

/**
 * Bring a document-store database up to date.
 * @param {import('better-sqlite3').Database} db
 * @param {{onApplied?: (m: {version:number, description:string}) => void}} [hooks]
 * @returns {number} the schema version now in effect
 */
function runMigrations(db, hooks = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version     INTEGER PRIMARY KEY,
    description TEXT,
    applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
  let current = (row && row.v) || 0;

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    const apply = db.transaction(() => {
      for (const sql of m.statements) db.exec(sql);
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        m.version,
        m.description,
      );
    });
    apply();
    if (hooks.onApplied) hooks.onApplied(m);
    current = m.version;
  }

  return current;
}

module.exports = { runMigrations, MIGRATIONS };
