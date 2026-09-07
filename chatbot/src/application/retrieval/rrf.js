/**
 * rrf — Reciprocal Rank Fusion.
 *
 * Merges ranked lists from sources whose scores are not comparable. FTS gives
 * a BM25-derived score (unbounded) and vector search gives a cosine
 * similarity (0..1); adding them, or min-max normalizing per query, is
 * unstable because the ranges shift with every question. RRF uses only RANK,
 * so it is scale-free — the standard hybrid-search merge.
 *
 *   rrf(hit) = SUM over sources of  1 / (k + rank_in_that_source)
 *
 * With k = 60, rank 1 contributes 1/61 and rank 2 contributes 1/62: close
 * together, so a hit ranked highly by two sources beats one ranked first by
 * only a single source. That is the property we want when a passage is both
 * lexically and semantically relevant.
 *
 * Pure and dependency-free, mirroring how orchestrator/routing.rs and
 * graph/routing.js are kept pure and unit-tested.
 */

'use strict';

const { RRF_K } = require('../graph/constants');

/**
 * Identity of a hit for fusion purposes. Two hits with the same key are the
 * same passage found by different sources, and their contributions add.
 */
function defaultKey(hit) {
  if (hit.sourceType === 'document') return `doc:${hit.sourceId}`;
  return `meeting:${hit.sourceTable}:${hit.sourceId}`;
}

/**
 * @param {import('../../domain/ports/EvidenceSource').EvidenceHit[][]} rankedLists
 *   each already sorted best-first
 * @param {{k?: number, limit?: number, key?: (hit: Object) => string}} [opts]
 * @returns {import('../../domain/ports/EvidenceSource').EvidenceHit[]}
 */
function fuse(rankedLists, opts = {}) {
  const k = opts.k == null ? RRF_K : opts.k;
  const key = opts.key || defaultKey;

  const merged = new Map();

  for (const list of rankedLists) {
    if (!Array.isArray(list)) continue;
    list.forEach((hit, index) => {
      const id = key(hit);
      const contribution = 1 / (k + index + 1); // rank is 1-based
      const existing = merged.get(id);
      if (existing) {
        existing.rrfScore += contribution;
        // Keep the better source-native rank for tie-breaking readability.
        existing.bestRank = Math.min(existing.bestRank, index + 1);
      } else {
        merged.set(id, { id, hit, rrfScore: contribution, bestRank: index + 1 });
      }
    });
  }

  const ordered = [...merged.values()].sort(
    (a, b) =>
      b.rrfScore - a.rrfScore ||
      a.bestRank - b.bestRank ||
      // Final tie-break on identity so the order is stable across runs.
      a.id.localeCompare(b.id),
  );

  const withScore = ordered.map((entry) => ({ ...entry.hit, rrfScore: entry.rrfScore }));
  return opts.limit ? withScore.slice(0, opts.limit) : withScore;
}

module.exports = { fuse, defaultKey };
