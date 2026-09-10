/**
 * compositeScore — the episodic re-rank: relevance + importance + recency.
 *
 * Pure and dependency-free, kept the way rrf.js and routing.js are kept
 * (Meeting Semantic Memory plan §05). Cosine similarity alone treats a
 * throwaway line from an hour ago the same as a high-significance decision
 * from three weeks ago phrased slightly differently; this re-ranks
 * EpisodicMemoryEvidenceSource's own hits before they reach RRF fusion with
 * the other sources — it is a re-rank within an already similarity-filtered
 * set, not a replacement for semantic match, which is why relevance keeps
 * the largest weight by default.
 */

'use strict';

const MS_PER_DAY = 86_400_000;

/**
 * @param {import('../../domain/ports/VectorIndex').VectorHit} hit
 * @param {number} now Date.now(), passed in so tests are deterministic
 * @param {{wRelevance: number, wImportance: number, wRecency: number, recencyHalflifeDays: number}} weights
 * @returns {number}
 */
function compositeScore(hit, now, { wRelevance, wImportance, wRecency, recencyHalflifeDays }) {
  const relevance = hit.similarity;
  const importance = typeof hit.payload?.importance === 'number' ? hit.payload.importance : 0.6;

  const ageMs = now - Date.parse(hit.payload?.created_at);
  // A malformed/missing timestamp must not corrupt ranking with NaN, and
  // clock skew must not hand a future-dated chunk a recency above 1.
  const ageDays = Number.isFinite(ageMs) ? Math.max(0, ageMs / MS_PER_DAY) : null;
  const recency = ageDays === null ? 0 : Math.exp((-Math.LN2 * ageDays) / recencyHalflifeDays);

  return wRelevance * relevance + wImportance * importance + wRecency * recency;
}

module.exports = { compositeScore };
