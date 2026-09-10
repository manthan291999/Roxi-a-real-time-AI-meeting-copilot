/**
 * SyncStateStore — generic key/value state for background sync jobs
 * (episodic memory's high-water mark, and later semantic memory's last-run
 * timestamp), persisted in chat_index.db's existing `index_meta` table.
 *
 * Reuses that table rather than a new file or a new DB: it is already
 * exactly `(key TEXT PRIMARY KEY, value TEXT)`, already lives in the
 * chatbot-owned index DB, and FtsIndexBuilder already proves two independent
 * classes can each open their own connection to that file safely (WAL).
 * A dedicated small class instead of adding methods to FtsIndexBuilder
 * itself: that class's job is building the FTS index, not arbitrary
 * key/value storage for an unrelated feature (SRP).
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { StoreError } = require('../../domain/errors');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS index_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

class SyncStateStore {
  /** @param {string} indexDbPath chatbot-owned index DB path (chat_index.db) */
  constructor(indexDbPath) {
    this.indexDbPath = indexDbPath;
    this.db = null;
  }

  _open() {
    if (this.db) return this.db;
    try {
      fs.mkdirSync(path.dirname(this.indexDbPath), { recursive: true });
      this.db = new Database(this.indexDbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.exec(SCHEMA);
    } catch (err) {
      throw new StoreError(`Cannot open index database at ${this.indexDbPath}: ${err.message}`);
    }
    return this.db;
  }

  /** @returns {string|null} */
  get(key) {
    const row = this._open().prepare('SELECT value FROM index_meta WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  /** @param {string} key @param {string|number} value */
  set(key, value) {
    this._open()
      .prepare(
        'INSERT INTO index_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(key, String(value));
  }

  close() {
    if (this.db) {
      try { this.db.close(); } catch (_) { /* best effort */ }
      this.db = null;
    }
  }
}

module.exports = { SyncStateStore };
