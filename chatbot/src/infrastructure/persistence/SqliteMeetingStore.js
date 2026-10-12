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

  /** @returns {Array<{id:number,start_time:string,end_time:string|null,status:string,context:string|null,name:string|null}>} */
  listMeetings() {
    try {
      return this._open()
        .prepare('SELECT id, start_time, end_time, status, context, name FROM meetings ORDER BY id')
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
  getAllGlossaryTerms() {
    const db = this._open();
    if (!db) return [];
    
    // Check if table exists
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='glossary_terms'")
      .get();
    if (!exists) return [];

    // Group by LOWER(term) across every meeting it was seen in. "Most recent
    // definition" is genuinely by time (first_seen DESC), not an alphabetic
    // MAX() over the definition text — two different things that only agree
    // by accident. project_id is populated only when every contributing
    // meeting shares one non-null project; mixed or absent project_id is
    // unscoped (null), matching "a term shouldn't look project-scoped from
    // one stray mention" (plan §06).
    return db.prepare(`
      WITH scoped AS (
        SELECT
          LOWER(g.term) AS term,
          g.definition AS definition,
          g.meeting_id AS meeting_id,
          g.first_seen AS first_seen,
          m.project_id AS project_id
        FROM glossary_terms g
        JOIN meetings m ON g.meeting_id = m.id
        WHERE g.definition IS NOT NULL AND TRIM(g.definition) != ''
      ),
      latest AS (
        SELECT term, definition,
          ROW_NUMBER() OVER (PARTITION BY term ORDER BY first_seen DESC, meeting_id DESC) AS rn
        FROM scoped
      )
      SELECT
        s.term AS term,
        l.definition AS definition,
        JSON_GROUP_ARRAY(DISTINCT s.meeting_id) AS meeting_ids,
        CASE
          WHEN COUNT(*) = COUNT(s.project_id) AND MIN(s.project_id) = MAX(s.project_id)
          THEN MIN(s.project_id)
          ELSE NULL
        END AS project_id,
        MAX(s.first_seen) AS last_seen
      FROM scoped s
      JOIN latest l ON l.term = s.term AND l.rn = 1
      GROUP BY s.term
    `).all().map(r => ({
      term: r.term,
      definition: r.definition,
      meeting_ids: JSON.parse(r.meeting_ids),
      project_id: r.project_id,
      last_seen: r.last_seen
    }));
  }

  /**
   * Ids of the meetings one account owns. Empty on a database the gateway
   * has not yet given an owner column (M011): then no meeting has an owner.
   * @param {string} accountId
   * @returns {number[]}
   */
  meetingIdsOwnedBy(accountId) {
    const db = this._open();
    if (!db) return [];
    try {
      const hasOwner = db.prepare('PRAGMA table_info(meetings)').all().some((c) => c.name === 'account_id');
      if (!hasOwner) return [];
      return db.prepare('SELECT id FROM meetings WHERE account_id = ? ORDER BY id').all(accountId).map((r) => r.id);
    } catch (err) {
      this.logger?.warn('store', 'meeting_ids_owned_by_failed', { message: err.message });
      return [];
    }
  }

  getMeetingRole(meetingId) {
    if (!meetingId) return null;
    const db = this._open();
    if (!db) return null;
    try {
      const row = db.prepare('SELECT role FROM meetings WHERE id = ?').get(meetingId);
      return row ? row.role : null;
    } catch (err) {
      this.logger?.warn('store', 'get_meeting_role_failed', { message: err.message });
      return null;
    }
  }

  close() {
    if (this.db) {
      try { this.db.close(); } catch (_) { /* best effort */ }
      this.db = null;
    }
  }
}

module.exports = { SqliteMeetingStore, SOURCES };
