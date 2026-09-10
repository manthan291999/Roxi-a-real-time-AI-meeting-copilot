/**
 * EpisodicMemoryEvidenceSource — EvidenceSource over embedded meeting chunks
 * (Meeting Semantic Memory plan §05/§10).
 *
 * Semantic search, same shape as DocumentEvidenceSource: embeds the question,
 * searches a vector index, and — the one thing that source doesn't do —
 * re-ranks by compositeScore (relevance + importance + recency) before
 * returning, active from day one rather than bolted on after.
 *
 * sourceType is 'meeting' and groupKey is `meeting:{id}` — identical to
 * FtsEvidenceSource's. A chunk found both lexically and semantically
 * collapses to one RRF entry with contributions from both ranks, which is
 * exactly the case RRF rewards (§10).
 *
 * Qdrant's payload is filter/scoring metadata, never the citation source of
 * truth: current speaker and verbatim text are re-hydrated from ChunkStore so
 * a rename_speaker after the fact, or a speaker column added later, is never
 * stale in an answer.
 */

'use strict';

const { MIN_COSINE_SIMILARITY } = require('../../application/graph/constants');
const { compositeScore } = require('../../application/retrieval/compositeScore');

class EpisodicMemoryEvidenceSource {
  /**
   * @param {Object} deps
   * @param {import('../../domain/ports/VectorIndex').VectorIndex} deps.vectorIndex
   * @param {import('../../domain/ports/EmbeddingGateway').EmbeddingGateway} deps.embeddings
   * @param {import('../../domain/ports/ChunkStore').ChunkStore} deps.chunkStore
   * @param {import('../../domain/ports/ChatLogger').ChatLogger} [deps.logger]
   * @param {number} [deps.minSimilarity]
   * @param {{wRelevance: number, wImportance: number, wRecency: number, recencyHalflifeDays: number}} deps.scoring
   */
  constructor({
    vectorIndex,
    embeddings,
    chunkStore,
    logger = null,
    minSimilarity = MIN_COSINE_SIMILARITY,
    scoring,
  }) {
    this.name = 'episodic_memory';
    this.vectorIndex = vectorIndex;
    this.embeddings = embeddings;
    this.chunkStore = chunkStore;
    this.logger = logger;
    this.minSimilarity = minSimilarity;
    this.scoring = scoring;
  }

  /**
   * @param {{question: string, limit: number, projectId?: number|null}} query
   * @returns {Promise<import('../../domain/ports/EvidenceSource').EvidenceHit[]>}
   */
  async search({ question, limit = 24, projectId = null } = {}) {
    if (!question || !String(question).trim()) return [];

    const vector = await this.embeddings.embedOne(question, { tag: 'embed_query' });
    const rawHits = await this.vectorIndex.search(vector, {
      limit,
      minSimilarity: this.minSimilarity,
      filter: { projectId },
    });
    if (rawHits.length === 0) return [];

    const now = Date.now();
    const reranked = rawHits
      .map((hit) => ({ ...hit, score: compositeScore(hit, now, this.scoring) }))
      .sort((a, b) => b.score - a.score);

    // Hydrate current speaker + verbatim text — Qdrant's payload is never
    // the citation source of truth (see class doc).
    const rows = this.chunkStore.chunksByIds(reranked.map((h) => h.id));
    const byId = new Map(rows.map((r) => [r.id, r]));

    const hits = reranked
      .map((h) => ({ ...h, row: byId.get(h.id) }))
      .filter((h) => h.row)
      .map((h) => ({
        sourceType: 'meeting',
        groupKey: `meeting:${h.row.meetingId}`,
        sourceTable: 'chunks',
        sourceId: h.id,
        meetingId: h.row.meetingId,
        meetingDate: h.row.meetingStartTime || '',
        speaker: h.row.speaker || '',
        text: h.row.text,
        score: h.score,
      }));

    this.logger?.debug('episodic_search', 'done', {
      rawHits: rawHits.length,
      hydrated: hits.length,
      minSimilarity: this.minSimilarity,
      projectId,
    });

    return hits;
  }
}

module.exports = { EpisodicMemoryEvidenceSource };
