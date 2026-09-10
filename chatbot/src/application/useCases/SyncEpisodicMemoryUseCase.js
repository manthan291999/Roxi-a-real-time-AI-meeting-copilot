/**
 * SyncEpisodicMemoryUseCase — Meeting Semantic Memory, Phase 2: embed every
 * historical `chunks` row once (backfill), resumable and idempotent.
 *
 * Mirrors FtsIndexBuilder.rebuildIfStale()'s shape (§09): a background job
 * driven by a CLI tool today, wired into the sidecar's own staleness timer
 * in Phase 4. Unlike the FTS rebuild, this is NOT a full rebuild each run —
 * embedding is a paid network call, so only chunks newer than the high-water
 * mark are processed.
 *
 * Batched with the high-water mark advanced after each batch, not once at
 * the end: if embedding budget runs out (or any batch fails) partway through
 * a large backfill, the next run resumes exactly where it left off instead
 * of re-embedding — or, worse, silently losing — everything already synced.
 */

'use strict';

const { textToEmbed, toEpisodicPayload } = require('../../infrastructure/vectorstore/episodicPayload');
const { BATCH_SIZE } = require('../../infrastructure/embedding/OpenAiEmbeddingGateway');

const HIGH_WATER_MARK_KEY = 'episodic_high_water_mark';

class SyncEpisodicMemoryUseCase {
  /**
   * @param {Object} deps
   * @param {import('../../domain/ports/ChunkStore').ChunkStore} deps.chunkStore
   * @param {import('../../domain/ports/EmbeddingGateway').EmbeddingGateway} deps.embeddings
   * @param {import('../../domain/ports/VectorIndex').VectorIndex} deps.vectorIndex
   * @param {import('../../infrastructure/sync/SyncStateStore').SyncStateStore} deps.syncState
   * @param {import('../../domain/ports/ChatLogger').ChatLogger} [deps.logger]
   */
  constructor({ chunkStore, embeddings, vectorIndex, syncState, logger = null }) {
    this.chunkStore = chunkStore;
    this.embeddings = embeddings;
    this.vectorIndex = vectorIndex;
    this.syncState = syncState;
    this.logger = logger;
  }

  /**
   * @param {{force?: boolean}} [opts] force: ignore the high-water mark and
   *   re-embed every chunk from scratch (re-embedding is an upsert by
   *   chunks.id, so this is safe to re-run, just costs a full re-embed).
   * @returns {Promise<{embedded: number, highWaterMark: number}>}
   */
  async execute({ force = false } = {}) {
    const since = force ? 0 : Number(this.syncState.get(HIGH_WATER_MARK_KEY) || 0);
    const pending = this.chunkStore.chunksSince(since);

    if (pending.length === 0) {
      return { embedded: 0, highWaterMark: since };
    }

    const embedModel = this.embeddings.model();
    const embedDims = this.embeddings.dimensions();

    let embedded = 0;
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const slice = pending.slice(i, i + BATCH_SIZE);
      const texts = slice.map(textToEmbed);

      const vectors = await this.embeddings.embedBatch(texts, { tag: 'embed_chunk' });

      const points = slice.map((chunk, j) => ({
        id: chunk.id,
        vector: Array.from(vectors[j]),
        payload: toEpisodicPayload(chunk, texts[j], { embedModel, embedDims }),
      }));
      await this.vectorIndex.upsertBatch(points);

      const upTo = slice[slice.length - 1].id;
      this.syncState.set(HIGH_WATER_MARK_KEY, upTo);
      embedded += slice.length;

      this.logger?.info('sync', 'episodic_batch_embedded', {
        batchSize: slice.length,
        upTo,
        totalPending: pending.length,
      });
    }

    return { embedded, highWaterMark: pending[pending.length - 1].id };
  }
}

module.exports = { SyncEpisodicMemoryUseCase, HIGH_WATER_MARK_KEY };
