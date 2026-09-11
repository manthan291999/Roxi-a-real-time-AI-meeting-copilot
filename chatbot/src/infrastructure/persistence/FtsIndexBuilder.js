/**
 * FtsIndexBuilder — builds the chatbot's OWN FTS5 index database.
 *
 * Decoupling guarantee: the meeting DB is only ever read; all index state
 * (chat_fts, meetings_ref, index_meta) lives in chatbot/data/chat_index.db.
 * A full rebuild is idempotent and cheap at this corpus size, so freshness
 * is handled by rebuildIfStale() (age + corpus-count heuristic) instead of
 * hooking into the capture pipeline's write path.
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
CREATE TABLE IF NOT EXISTS meetings_ref (
  id         INTEGER PRIMARY KEY,
  start_time TEXT,
  status     TEXT,
  context    TEXT,
  name       TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS chat_fts USING fts5(
  source_table UNINDEXED,
  source_id    UNINDEXED,
  meeting_id   UNINDEXED,
  speaker,
  text,
  tokenize = 'porter unicode61'
);
`;

class FtsIndexBuilder {
  /**
   * @param {string} indexDbPath chatbot-owned index DB path
   * @param {import('../../domain/ports/ChatLogger').ChatLogger} [logger]
   */
  constructor(indexDbPath, logger = null) {
    this.indexDbPath = indexDbPath;
    this.logger = logger;
    this.db = null;
  }

  _open() {
    if (this.db) return this.db;
    try {
      fs.mkdirSync(path.dirname(this.indexDbPath), { recursive: true });
      this.db = new Database(this.indexDbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.exec(SCHEMA);
      // `CREATE TABLE IF NOT EXISTS` above only shapes a fresh index — an
      // already-existing chat_index.db on disk keeps its old `meetings_ref`
      // columns, so `name` needs its own local, idempotent migration here.
      const hasName = this.db
        .prepare("SELECT 1 FROM pragma_table_info('meetings_ref') WHERE name = 'name'")
        .get();
      if (!hasName) {
        this.db.exec('ALTER TABLE meetings_ref ADD COLUMN name TEXT');
      }
    } catch (err) {
      throw new StoreError(`Cannot open index database at ${this.indexDbPath}: ${err.message}`);
    }
    return this.db;
  }

  /** @returns {{builtAt:number|null, corpusCount:number}} */
  readMeta() {
    const db = this._open();
    const rows = db.prepare('SELECT key, value FROM index_meta').all();
    const meta = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      builtAt: meta.built_at ? Number(meta.built_at) : null,
      corpusCount: meta.corpus_count ? Number(meta.corpus_count) : 0,
    };
  }

  /**
   * Full idempotent rebuild from a MeetingStore snapshot.
   * @param {import('../../domain/ports/MeetingStore').MeetingStore} store
   * @returns {{corpusCount:number, meetingCount:number, durationMs:number}}
   */
  rebuild(store) {
    const db = this._open();
    const started = Date.now();

    const rows = store.iterSourceRows();
    const meetings = store.listMeetings();

    const insertFts = db.prepare(
      'INSERT INTO chat_fts (source_table, source_id, meeting_id, speaker, text) VALUES (?, ?, ?, ?, ?)'
    );
    const insertMeeting = db.prepare(
      'INSERT OR REPLACE INTO meetings_ref (id, start_time, status, context, name) VALUES (?, ?, ?, ?, ?)'
    );
    const setMeta = db.prepare(
      'INSERT INTO index_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );

    const txn = db.transaction(() => {
      db.exec('DELETE FROM chat_fts; DELETE FROM meetings_ref;');
      for (const m of meetings) {
        insertMeeting.run(m.id, m.start_time || '', m.status || '', m.context || '', m.name || '');
      }
      for (const r of rows) {
        insertFts.run(r.sourceTable, r.sourceId, r.meetingId, r.speaker || '', r.text);
      }
      setMeta.run('built_at', String(Date.now()));
      setMeta.run('corpus_count', String(rows.length));
      setMeta.run('meeting_count', String(meetings.length));
    });
    txn();

    const durationMs = Date.now() - started;
    this.logger?.info('index', 'rebuild_complete', {
      corpusCount: rows.length,
      meetingCount: meetings.length,
      durationMs,
    });
    return { corpusCount: rows.length, meetingCount: meetings.length, durationMs };
  }

  /**
   * Rebuild when the index is missing, empty, stale, or the corpus changed.
   * @param {import('../../domain/ports/MeetingStore').MeetingStore} store
   * @param {{maxAgeMs?: number}} [opts]
   * @returns {{rebuilt:boolean, reason:string, stats?: object}}
   */
  rebuildIfStale(store, { maxAgeMs = 30 * 60 * 1000 } = {}) {
    const meta = this.readMeta();
    const now = Date.now();

    let reason = null;
    if (!meta.builtAt) reason = 'missing';
    else if (now - meta.builtAt > maxAgeMs) reason = 'stale';
    else {
      const meetingCount = store.listMeetings().length;
      const storedMeetings = this._open()
        .prepare('SELECT COUNT(*) AS c FROM meetings_ref')
        .get().c;
      if (meetingCount !== storedMeetings) reason = 'meeting_count_changed';
    }

    if (!reason) return { rebuilt: false, reason: 'fresh' };
    const stats = this.rebuild(store);
    return { rebuilt: true, reason, stats };
  }

  close() {
    if (this.db) {
      try { this.db.close(); } catch (_) { /* best effort */ }
      this.db = null;
    }
  }
}

module.exports = { FtsIndexBuilder };
