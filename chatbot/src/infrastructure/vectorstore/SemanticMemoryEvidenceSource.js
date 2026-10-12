'use strict';

const { MIN_COSINE_SIMILARITY } = require('../../application/graph/constants');

class SemanticMemoryEvidenceSource {
  /**
   * @param {Object} deps
   * @param {import('../../domain/ports/VectorIndex').VectorIndex} deps.vectorIndex
   * @param {import('../../domain/ports/EmbeddingGateway').EmbeddingGateway} deps.embeddings
   * @param {import('../../domain/ports/ChatLogger').ChatLogger} [deps.logger]
   * @param {number} [deps.minSimilarity]
   */
  constructor({
    vectorIndex,
    embeddings,
    logger = null,
    minSimilarity = MIN_COSINE_SIMILARITY,
  }) {
    this.name = 'semantic_memory';
    this.vectorIndex = vectorIndex;
    this.embeddings = embeddings;
    this.logger = logger;
    this.minSimilarity = minSimilarity;
  }

  /**
   * @param {{question: string, limit: number, projectId?: number|null, meetingIds?: number[]|null}} query
   *   meetingIds: only these meetings (the signed-in account's); null = all
   * @returns {Promise<import('../../domain/ports/EvidenceSource').EvidenceHit[]>}
   */
  async search({ question, limit = 24, projectId = null, meetingIds = null } = {}) {
    if (!question || !String(question).trim()) return [];
    if (Array.isArray(meetingIds) && meetingIds.length === 0) return [];

    const vector = await this.embeddings.embedOne(question, { tag: 'embed_query' });
    const rawHits = await this.vectorIndex.search(vector, {
      limit,
      minSimilarity: this.minSimilarity,
      filter: { projectId, meetingIds, meetingIdsKey: 'meeting_ids' },
    });
    if (rawHits.length === 0) return [];

    // Semantic memory has no recency decay, just uses vector similarity
    const hits = rawHits.map(h => ({
      sourceType: 'semantic',
      groupKey: `glossary:${h.payload.term}`,
      sourceTable: h.payload.source_table,
      sourceId: h.id,
      meetingId: null, // applies cross-meeting
      meetingDate: '',
      speaker: '',
      text: `${h.payload.term}: ${h.payload.definition}`,
      score: h.similarity,
    }));

    this.logger?.debug('semantic_search', 'done', {
      hits: hits.length,
      minSimilarity: this.minSimilarity,
      projectId,
    });

    return hits;
  }
}

module.exports = { SemanticMemoryEvidenceSource };
