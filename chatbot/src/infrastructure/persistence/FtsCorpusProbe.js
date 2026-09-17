/**
 * Infrastructure: FtsCorpusProbe — a CorpusProbe over the chatbot's own
 * FTS5 index (chat_fts). Backs the gibberish gate's corpus check (see
 * application/guardrail/gibberish.js and domain/ports/CorpusProbe.js): if a
 * shape-suspicious token appears anywhere in the user's own meetings or
 * documents, it is meaningful here by definition, whatever it looks like.
 *
 * FAILS OPEN, ALWAYS — this is part of the CorpusProbe contract, not an
 * implementation choice this class is free to relax: a missing index, a
 * corrupt file, a locked database, or any other read failure resolves to
 * `true` (found), never `false` and never a thrown error. A read failure
 * must never manufacture a false accusation that a user's real question is
 * nonsense — see gibberish.js's header comment on why a false positive
 * there is unrecoverable while a false negative costs one skipped check.
 *
 * TOKENIZER: chat_fts is built with `tokenize = 'porter unicode61'` (see
 * FtsIndexBuilder.js's own SCHEMA) — a STEMMED index. This probes with a
 * plain MATCH against the raw term and lets FTS5 apply the SAME stemmer to
 * the query that it already applied to the indexed content, rather than
 * hand-rolling stemming here — reimplementing the porter algorithm to
 * agree with SQLite's own C implementation would be redundant today and
 * would silently drift the moment either one changed.
 *
 * COLD START: a fresh install's index is empty, so every probe legitimately
 * returns false — that is a correct "not found" answer, not a failure, and
 * is NOT what fail-open guards against (see the pre-router plan §06). On an
 * empty index, gibberish.js's shape gate alone carries the classification;
 * that is an accepted, conservative degradation, not a bug here.
 */

const Database = require('better-sqlite3');
const { sanitizeToken } = require('./ftsQuery');

class FtsCorpusProbe {
  /**
   * @param {string} indexDbPath chatbot-owned FTS index DB
   * @param {import('../../domain/ports/ChatLogger').ChatLogger} [logger]
   */
  constructor(indexDbPath, logger = null) {
    this.indexDbPath = indexDbPath;
    this.logger = logger;
    this.db = null;
    this.stmt = null;
  }

  _open() {
    if (this.stmt) return this.stmt;
    this.db = new Database(this.indexDbPath, { readonly: true, fileMustExist: true });
    this.stmt = this.db.prepare('SELECT 1 FROM chat_fts WHERE chat_fts MATCH ? LIMIT 1');
    return this.stmt;
  }

  /**
   * @param {string} term a single word — already tokenized and cleaned by
   *   the caller (gibberish.js). Sanitized again here defensively: this
   *   probe is a separate entry point into FTS5 MATCH syntax from the
   *   analyze_query/rewrite_query path ftsQuery.js was originally built
   *   for, and a gibberish-shaped token is exactly the kind of input most
   *   likely to contain a leftover FTS5-special character.
   * @returns {boolean} true when found, or when the probe could not run at
   *   all — see this file's header comment on failing open. False only on
   *   a genuine, successful "not found".
   */
  has(term) {
    const clean = sanitizeToken(term);
    if (!clean) return true; // nothing left to search — do not accuse
    try {
      const stmt = this._open();
      return stmt.get(clean) !== undefined;
    } catch (err) {
      this.logger?.warn('corpus_probe', 'probe_failed', {
        term: String(term).slice(0, 60),
        message: err.message,
      });
      return true; // fail open — see this file's header comment
    }
  }

  close() {
    if (this.db) {
      try { this.db.close(); } catch (_) { /* best effort */ }
      this.db = null;
      this.stmt = null;
    }
  }
}

module.exports = { FtsCorpusProbe };
