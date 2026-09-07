/**
 * CompositeEvidenceSource — fans one question out to every corpus and merges
 * the results.
 *
 * Itself an EvidenceSource, so retrieveNode receives exactly one collaborator
 * and cannot tell whether it is talking to one corpus or four (Liskov). Adding
 * a fourth source later — Slack, Jira, Notion — is a new adapter registered in
 * the composition root; this class and retrieveNode never change again
 * (Open/Closed).
 *
 * Merging is rank-based (see rrf.js) because source scores are not comparable.
 */

'use strict';

const { fuse } = require('./rrf');

class CompositeEvidenceSource {
  /**
   * @param {Object} deps
   * @param {import('../../domain/ports/EvidenceSource').EvidenceSource[]} deps.sources
   * @param {import('../../domain/ports/ChatLogger').ChatLogger} [deps.logger]
   */
  constructor({ sources, logger = null }) {
    this.name = 'composite';
    this.sources = (sources || []).filter(Boolean);
    this.logger = logger;
  }

  /**
   * @param {{question: string, matchExprs: string[], limit: number}} query
   * @returns {Promise<import('../../domain/ports/EvidenceSource').EvidenceHit[]>}
   */
  async search(query) {
    if (this.sources.length === 0) return [];

    // Concurrent: the meeting source is a local SQLite read and the document
    // source is a network round trip, so running them in sequence would add
    // the embedding latency to every question for no reason.
    const settled = await Promise.all(
      this.sources.map(async (source) => {
        try {
          const hits = await source.search(query);
          return { name: source.name, hits: Array.isArray(hits) ? hits : [] };
        } catch (err) {
          // One corpus failing must not fail the question. A missing document
          // store or a rate-limited embedding call still leaves the meeting
          // corpus perfectly usable, so this degrades instead of throwing.
          this.logger?.warn('composite', 'source_failed', {
            source: source.name,
            message: String(err && err.message).slice(0, 200),
          });
          return { name: source.name, hits: [], failed: true };
        }
      }),
    );

    const merged = fuse(
      settled.map((s) => s.hits),
      { limit: query && query.limit },
    );

    this.logger?.info('composite', 'search_done', {
      perSource: settled.map((s) => `${s.name}:${s.failed ? 'failed' : s.hits.length}`).join(' '),
      merged: merged.length,
    });

    return merged;
  }
}

module.exports = { CompositeEvidenceSource };
