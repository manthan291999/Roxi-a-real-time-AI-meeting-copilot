/**
 * DocumentEvidenceSource — EvidenceSource over uploaded documents.
 *
 * Semantic search: the question is embedded and matched against stored chunk
 * vectors by cosine similarity. This is why the port carries `question`
 * alongside `matchExprs` — the sanitized FTS5 expressions the meeting source
 * uses are useless here.
 */

'use strict';

const { MIN_COSINE_SIMILARITY } = require('../../application/graph/constants');

class DocumentEvidenceSource {
  /**
   * @param {Object} deps
   * @param {import('../../domain/ports/DocumentRepository').DocumentRepository} deps.documents
   * @param {import('../../domain/ports/EmbeddingGateway').EmbeddingGateway} deps.embeddings
   * @param {import('../../domain/ports/ChatLogger').ChatLogger} [deps.logger]
   * @param {number} [deps.minSimilarity]
   */
  constructor({ documents, embeddings, logger = null, minSimilarity = MIN_COSINE_SIMILARITY }) {
    this.name = 'documents';
    this.documents = documents;
    this.embeddings = embeddings;
    this.logger = logger;
    this.minSimilarity = minSimilarity;
  }

  /**
   * @param {{question: string, limit: number}} query
   * @returns {Promise<import('../../domain/ports/EvidenceSource').EvidenceHit[]>}
   */
  async search({ question, limit = 24 } = {}) {
    if (!question || !String(question).trim()) return [];

    // Check the corpus BEFORE embedding. With no documents uploaded there is
    // nothing to match, and embedding anyway would bill a request on every
    // question asked for the entire life of an install with no documents.
    const { count } = this.documents.stats();
    if (count === 0) return [];

    const vector = await this.embeddings.embedOne(question, { tag: 'embed_query' });
    const hits = this.documents.searchByVector(vector, {
      limit,
      minSimilarity: this.minSimilarity,
    });

    this.logger?.debug('doc_search', 'done', {
      documents: count,
      hits: hits.length,
      minSimilarity: this.minSimilarity,
    });

    return hits.map((hit) => ({
      sourceType: 'document',
      groupKey: `doc:${hit.docId}`,
      // Kept structurally compatible with meeting hits so the existing
      // evidence/citation path treats these as ordinary hits until it is
      // generalized: the dedupe key there is meetingId:sourceTable:sourceId.
      sourceTable: 'documents',
      sourceId: hit.chunkId,
      meetingId: null,
      meetingDate: '',
      speaker: '',
      docId: hit.docId,
      fileName: hit.fileName,
      pageNumber: hit.pageNumber,
      text: hit.text,
      score: hit.similarity,
    }));
  }
}

module.exports = { DocumentEvidenceSource };
