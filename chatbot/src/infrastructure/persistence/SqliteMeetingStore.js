/**
 * SqliteMeetingStore — MeetingStore adapter over the capture pipeline's DB.
 *
 * Decoupling rules:
 *  - Opens the meeting DB READ-ONLY (WAL-safe alongside a live capture).
 *  - If a readonly open is impossible (e.g. missing -shm on first access),
 *    falls back to a normal connection but still only ever runs SELECTs.
 *  - Knows the source schema, so the rest of the chatbot never touches SQL
 *    for the meeting DB (Single Responsibility).
 */

const Database = require('better-sqlite3');
const { StoreError } = require('../../domain/errors');

/** Indexable sources: table -> { textExpr, speakerExpr } */
const SOURCES = [
  { table: 'transcripts', textExpr: 'text', speakerExpr: "COALESCE(speaker, '')" },
  { table: 'summaries', textExpr: 'text', speakerExpr: "''" },
  { table: 'decisions', textExpr: 'description', speakerExpr: "''" },
  { table: 'action_items', textExpr: "COALESCE(assignee || ': ', '') || description", speakerExpr: "COALESCE(assignee, '')" },
  { table: 'risks', textExpr: 'text', speakerExpr: "''" },
];

class SqliteMeetingStore {
  /**
   * @param {string} dbPath absolute path to meeting_history.db
   * @param {import('../../domain/ports/ChatLogger').ChatLogger} [logger]
   */
  constructor(dbPath, logger = null) {
    this.dbPath = dbPath;
    this.logger = logger;
    this.db = null;
  }

  /** Lazy open — readonly first, graceful fallback to normal connection. */
  _open() {
    if (this.db) return this.db;
    try {
      this.db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
      this.readonly = true;
    } catch (err) {
      this.logger?.warn('store', 'readonly_open_failed_falling_back', { message: err.message });
      try {
        this.db = new Database(this.dbPath, { fileMustExist: true });
        this.readonly = false;
      } catch (err2) {
        throw new StoreError(`Cannot open meeting database at ${this.dbPath}: ${err2.message}`);
      }
    }
    return this.db;
  }

  /** @returns {Array<{id:number,start_time:string,end_time:string|null,status:string,context:string|null}>} */
  listMeetings() {
    try {
      return this._open()
        .prepare('SELECT id, start_time, end_time, status, context FROM meetings ORDER BY id')
        .all();
    } catch (err) {
      throw new StoreError(`listMeetings failed: ${err.message}`);
    }
  }

  /** @returns {Map<number, string>} meetingId -> start_time */
  meetingDates() {
    const map = new Map();
    for (const m of this.listMeetings()) map.set(m.id, m.start_time || '');
    return map;
  }

  /**
   * All indexable rows across source tables (bounded corpus).
   * Missing tables are skipped defensively (schema may predate migrations).
   * @returns {import('../../domain/ports/MeetingStore').SourceRow[]}
   */
  iterSourceRows() {
    const db = this._open();
    const rows = [];
    for (const src of SOURCES) {
      const exists = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?")
        .get(src.table);
      if (!exists) continue;
      try {
        const found = db
          .prepare(
            `SELECT id AS source_id, meeting_id AS meetingId, ${src.speakerExpr} AS speaker, ${src.textExpr} AS text
             FROM ${src.table}
             WHERE ${src.textExpr} IS NOT NULL AND TRIM(${src.textExpr}) != ''
             ORDER BY id`
          )
          .all();
        for (const r of found) {
          rows.push({
            sourceTable: src.table,
            sourceId: r.source_id,
            meetingId: r.meetingId,
            speaker: r.speaker || '',
            text: String(r.text),
          });
        }
      } catch (err) {
        this.logger?.warn('store', 'source_scan_failed', { table: src.table, message: err.message });
      }
    }
    return rows;
  }

  close() {
    if (this.db) {
      try { this.db.close(); } catch (_) { /* best effort */ }
      this.db = null;
    }
  }
}

module.exports = { SqliteMeetingStore, SOURCES };
