/**
 * FtsRetriever — Retriever adapter over the chatbot-owned FTS index.
 *
 * Runs BM25-ranked MATCH queries, joins meeting dates locally (from
 * meetings_ref), dedupes across multiple query expressions, and returns
 * ranked EvidenceHits. Never touches the live meeting DB at query time.
 */

const Database = require('better-sqlite3');
const { StoreError } = require('../../domain/errors');
const { SNIPPET_MAX_CHARS } = require('../../application/graph/constants');

class FtsRetriever {
  /**
   * @param {string} indexDbPath chatbot-owned index DB
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
      this.db = new Database(this.indexDbPath, { readonly: true, fileMustExist: true });
    } catch (err) {
      throw new StoreError(
        `Chat index not available at ${this.indexDbPath} — run rebuild-index first: ${err.message}`
      );
    }
    return this.db;
  }

  /**
   * @param {string[]} matchExprs sanitized FTS5 MATCH expressions
   * @param {{limit?: number}} [opts]
   * @returns {import('../../domain/ports/Retriever').EvidenceHit[]}
   */
  search(matchExprs, { limit = 24 } = {}) {
    if (!Array.isArray(matchExprs) || matchExprs.length === 0) return [];
    const db = this._open();

    const stmt = db.prepare(`
      SELECT f.source_table  AS sourceTable,
             f.source_id     AS sourceId,
             f.meeting_id    AS meetingId,
             f.speaker       AS speaker,
             snippet(chat_fts, 4, '', '', ' … ', 48) AS snippetText,
             bm25(chat_fts)  AS bm25,
             m.start_time    AS meetingDate,
             m.name          AS meetingName
      FROM chat_fts AS f
      LEFT JOIN meetings_ref AS m ON m.id = f.meeting_id
      WHERE chat_fts MATCH ?
      ORDER BY bm25(chat_fts)
      LIMIT ?
    `);

    const seen = new Map(); // key -> hit (dedupe across expressions)
    for (const expr of matchExprs) {
      let rows;
      try {
        rows = stmt.all(expr, limit);
      } catch (err) {
        // Malformed expression (should not happen post-sanitize) — skip it.
        this.logger?.warn('retriever', 'match_failed', { expr: String(expr).slice(0, 120), message: err.message });
        continue;
      }
      for (const r of rows) {
        const key = `${r.sourceTable}:${r.sourceId}`;
        const prev = seen.get(key);
        if (prev && prev.bm25 <= r.bm25) continue; // keep best (lowest bm25)
        seen.set(key, {
          meetingId: r.meetingId,
          meetingDate: r.meetingDate || '',
          meetingName: r.meetingName || '',
          sourceTable: r.sourceTable,
          sourceId: r.sourceId,
          speaker: r.speaker || '',
          text: clip(r.snippetText || '', SNIPPET_MAX_CHARS),
          bm25: r.bm25,
        });
      }
      // First (most precise) expression satisfied the limit → stop early.
      if (seen.size >= limit) break;
    }

    return [...seen.values()]
      .sort((a, b) => a.bm25 - b.bm25) // bm25: lower = better
      .slice(0, limit)
      .map((h) => ({ ...h, score: -h.bm25 }));
  }

  /**
   * Latest meetings that have summaries, most recent first.
   * Used to offer concrete options when a vague question matches nothing.
   * @param {number} [limit=5]
   * @returns {Array<{meetingId:number, meetingDate:string, topic:string}>}
   */
  recentTopics(limit = 5) {
    const db = this._open();
    try {
      return db
        .prepare(`
          SELECT f.meeting_id AS meetingId,
                 m.start_time AS meetingDate,
                 substr(f.text, 1, 220) AS topic
          FROM chat_fts AS f
          LEFT JOIN meetings_ref AS m ON m.id = f.meeting_id
          WHERE f.source_table = 'summaries'
          ORDER BY f.meeting_id DESC
          LIMIT ?
        `)
        .all(limit)
        .map((r) => ({
          meetingId: r.meetingId,
          meetingDate: r.meetingDate || '',
          topic: firstSentence(r.topic),
        }));
    } catch (err) {
      this.logger?.warn('retriever', 'recent_topics_failed', { message: err.message });
      return [];
    }
  }

  close() {
    if (this.db) {
      try { this.db.close(); } catch (_) { /* best effort */ }
      this.db = null;
    }
  }
}

function clip(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

/** First meaningful sentence of a summary (skips markdown headers). */
function firstSentence(text) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.replace(/[#_*>`]+/g, '').trim())
    .filter((l) => l.length >= 20);
  const line = lines[0] || String(text || '').slice(0, 120);
  const cut = line.match(/^(.{20,140}?[.!?])\s/);
  return clip(cut ? cut[1] : line, 140);
}

module.exports = { FtsRetriever };
