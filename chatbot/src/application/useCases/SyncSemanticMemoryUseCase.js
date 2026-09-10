'use strict';

const { toSemanticPayload, generateSemanticId } = require('../../infrastructure/vectorstore/semanticPayload');
const { BATCH_SIZE } = require('../../infrastructure/embedding/OpenAiEmbeddingGateway');

class SyncSemanticMemoryUseCase {
  /**
   * @param {Object} deps
   * @param {import('../../domain/ports/MeetingStore').MeetingStore} deps.meetingStore
   * @param {import('../../domain/ports/EmbeddingGateway').EmbeddingGateway} deps.embeddings
   * @param {import('../../domain/ports/VectorIndex').VectorIndex} deps.vectorIndex
   * @param {import('../../domain/ports/ChatLogger').ChatLogger} [deps.logger]
   */
  constructor({ meetingStore, embeddings, vectorIndex, logger = null }) {
    this.meetingStore = meetingStore;
    this.embeddings = embeddings;
    this.vectorIndex = vectorIndex;
    this.logger = logger;
  }

  async execute() {
    const terms = this.meetingStore.getAllGlossaryTerms();
    if (terms.length === 0) {
      return { embedded: 0 };
    }

    let embedded = 0;
    for (let i = 0; i < terms.length; i += BATCH_SIZE) {
      const slice = terms.slice(i, i + BATCH_SIZE);
      const texts = slice.map(t => `${t.term}: ${t.definition}`);

      const vectors = await this.embeddings.embedBatch(texts, { tag: 'embed_glossary' });

      const points = slice.map((termRow, j) => ({
        id: generateSemanticId(termRow.term),
        vector: Array.from(vectors[j]),
        payload: toSemanticPayload(termRow),
      }));
      await this.vectorIndex.upsertBatch(points);

      embedded += slice.length;

      this.logger?.info('sync', 'semantic_batch_embedded', {
        batchSize: slice.length,
        totalPending: terms.length,
      });
    }

    return { embedded };
  }
}

module.exports = { SyncSemanticMemoryUseCase };
