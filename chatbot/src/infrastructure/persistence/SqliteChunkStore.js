/**
 * SqliteChunkStore — ChunkStore adapter over the capture pipeline's DB.
 *
 * Same read-only-with-fallback connection rule as SqliteMeetingStore (WAL-
 * safe alongside a live capture), kept in its own class rather than reusing
 * SqliteMeetingStore's connection because the two ports serve different
 * callers with different queries (ISP) — see ChunkStore's doc comment.
 */

const Database = require('better-sqlite3');
const { StoreError } = require('../../domain/errors');

const CHUNK_SELECT = `
  SELECT c.id, c.meeting_id AS meetingId, c.seq AS chunkSeq, c.speaker, c.text,
         c.topic, c.significance, c.created_at AS createdAt,
         m.project_id AS projectId, m.display_id AS displayId,
         m.start_time AS meetingStartTime, m.context AS meetingContext
  FROM chunks c
  JOIN meetings m ON m.id = c.meeting_id
`;

class SqliteChunkStore {
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
    } catch (err) {
      this.logger?.warn('chunkstore', 'readonly_open_failed_falling_back', { message: err.message });
      try {
        this.db = new Database(this.dbPath, { fileMustExist: true });
      } catch (err2) {
        throw new StoreError(`Cannot open meeting database at ${this.dbPath}: ${err2.message}`);
      }
    }
    return this.db;
  }

  /**
   * @param {number} sinceId
   * @returns {import('../../domain/ports/ChunkStore').ChunkRecord[]}
   */
  chunksSince(sinceId) {
    try {
      const rows = this._open()
        .prepare(
          `${CHUNK_SELECT} WHERE c.id > ? AND c.text IS NOT NULL AND TRIM(c.text) != '' ORDER BY c.id`
        )
        .all(sinceId);
      return this._attachLinkedIds(rows);
    } catch (err) {
      throw new StoreError(`chunksSince failed: ${err.message}`);
    }
  }

  /**
   * @param {number[]} ids
   * @returns {import('../../domain/ports/ChunkStore').ChunkRecord[]}
   */
  chunksByIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    try {
      const placeholders = ids.map(() => '?').join(',');
      const rows = this._open()
        .prepare(`${CHUNK_SELECT} WHERE c.id IN (${placeholders})`)
        .all(...ids);
      return this._attachLinkedIds(rows);
    } catch (err) {
      throw new StoreError(`chunksByIds failed: ${err.message}`);
    }
  }

  /**
   * One extra query per linked table, grouped client-side, rather than three
   * JOINs in CHUNK_SELECT — a chunk can have multiple decisions/risks/action
   * items, and joining all three would multiply chunk rows by their cross
   * product instead of just tagging each chunk with its id lists.
   * @private
   */
  _attachLinkedIds(rows) {
    if (rows.length === 0) return rows;
    const db = this._open();
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');

    const linkedFor = (table) => {
      const map = new Map();
      const found = db
        .prepare(`SELECT chunk_id, id FROM ${table} WHERE chunk_id IN (${placeholders})`)
        .all(...ids);
      for (const { chunk_id, id } of found) {
        if (!map.has(chunk_id)) map.set(chunk_id, []);
        map.get(chunk_id).push(id);
      }
      return map;
    };

    const decisions = linkedFor('decisions');
    const risks = linkedFor('risks');
    const actionItems = linkedFor('action_items');

    return rows.map((r) => ({
      ...r,
      speaker: r.speaker || '',
      linkedDecisionIds: decisions.get(r.id) || [],
      linkedRiskIds: risks.get(r.id) || [],
      linkedActionItemIds: actionItems.get(r.id) || [],
    }));
  }

  close() {
    if (this.db) {
      try { this.db.close(); } catch (_) { /* best effort */ }
      this.db = null;
    }
  }
}

module.exports = { SqliteChunkStore };
