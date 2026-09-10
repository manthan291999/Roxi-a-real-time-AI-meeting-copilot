/**
 * Unit tests: SyncEpisodicMemoryUseCase — batching, high-water-mark
 * resumability, and force re-embed. ChunkStore/EmbeddingGateway/VectorIndex/
 * SyncStateStore are all fakes, so no DB and no network call happens, same
 * convention as document-evidence-source.test.js.
 */
const test = require('node:test');
const assert = require('node:assert');

const { SyncEpisodicMemoryUseCase, HIGH_WATER_MARK_KEY } = require('../src/application/useCases/SyncEpisodicMemoryUseCase');
const { BATCH_SIZE } = require('../src/infrastructure/embedding/OpenAiEmbeddingGateway');

function fakeChunk(id) {
  return {
    id,
    meetingId: 1,
    chunkSeq: id,
    projectId: null,
    displayId: 'ROXI-001',
    speaker: 'Speaker A',
    text: `chunk number ${id}`,
    topic: null,
    significance: 'medium',
    createdAt: '2026-08-20T10:00:00.000Z',
    meetingStartTime: '2026-08-20T09:55:00.000Z',
    meetingContext: null,
    linkedDecisionIds: [],
    linkedRiskIds: [],
    linkedActionItemIds: [],
  };
}

function fakeChunkStore(allChunks) {
  return { chunksSince: (since) => allChunks.filter((c) => c.id > since) };
}

function fakeEmbeddings() {
  const calls = [];
  return {
    calls,
    model: () => 'fake-embed',
    dimensions: () => 4,
    embedBatch: async (texts) => {
      calls.push(texts.length);
      return texts.map(() => [0, 0, 0, 1]);
    },
  };
}

function fakeVectorIndex({ failOnBatch = null } = {}) {
  const batches = [];
  let batchCount = 0;
  return {
    batches,
    upsertBatch: async (points) => {
      batchCount += 1;
      if (failOnBatch === batchCount) throw new Error(`simulated failure on batch ${batchCount}`);
      batches.push(points);
    },
  };
}

function fakeSyncState(initial = {}) {
  const store = { ...initial };
  return {
    store,
    get: (key) => (key in store ? store[key] : null),
    set: (key, value) => { store[key] = String(value); },
  };
}

function useCase({ chunks, embeddings, vectorIndex, syncState }) {
  return new SyncEpisodicMemoryUseCase({
    chunkStore: fakeChunkStore(chunks),
    embeddings: embeddings || fakeEmbeddings(),
    vectorIndex: vectorIndex || fakeVectorIndex(),
    syncState: syncState || fakeSyncState(),
  });
}

test('SyncEpisodicMemoryUseCase', async (t) => {
  await t.test('no pending chunks: no embed/upsert calls, high-water mark unchanged', async () => {
    const embeddings = fakeEmbeddings();
    const vectorIndex = fakeVectorIndex();
    const syncState = fakeSyncState({ [HIGH_WATER_MARK_KEY]: '5' });

    const result = await useCase({ chunks: [], embeddings, vectorIndex, syncState }).execute();

    assert.deepStrictEqual(result, { embedded: 0, highWaterMark: 5 });
    assert.strictEqual(embeddings.calls.length, 0);
    assert.strictEqual(vectorIndex.batches.length, 0);
  });

  await t.test('a small batch is embedded and upserted in one call, mark advances to the last id', async () => {
    const chunks = [fakeChunk(1), fakeChunk(2), fakeChunk(3)];
    const embeddings = fakeEmbeddings();
    const vectorIndex = fakeVectorIndex();
    const syncState = fakeSyncState();

    const result = await useCase({ chunks, embeddings, vectorIndex, syncState }).execute();

    assert.deepStrictEqual(result, { embedded: 3, highWaterMark: 3 });
    assert.deepStrictEqual(embeddings.calls, [3]);
    assert.strictEqual(vectorIndex.batches.length, 1);
    assert.strictEqual(vectorIndex.batches[0].length, 3);
    assert.strictEqual(syncState.get(HIGH_WATER_MARK_KEY), '3');
  });

  await t.test('resumes from the stored high-water mark by default', async () => {
    const chunks = [fakeChunk(1), fakeChunk(2), fakeChunk(3)];
    const syncState = fakeSyncState({ [HIGH_WATER_MARK_KEY]: '1' });

    const result = await useCase({ chunks, syncState }).execute();

    assert.strictEqual(result.embedded, 2); // only chunks 2 and 3
    assert.strictEqual(result.highWaterMark, 3);
  });

  await t.test('force ignores the stored mark and re-embeds everything', async () => {
    const chunks = [fakeChunk(1), fakeChunk(2)];
    const syncState = fakeSyncState({ [HIGH_WATER_MARK_KEY]: '2' });

    const result = await useCase({ chunks, syncState }).execute({ force: true });

    assert.strictEqual(result.embedded, 2);
  });

  await t.test('more chunks than one embedding batch: splits into multiple upserts, mark advances per batch', async () => {
    const chunks = Array.from({ length: BATCH_SIZE + 1 }, (_, i) => fakeChunk(i + 1));
    const embeddings = fakeEmbeddings();
    const vectorIndex = fakeVectorIndex();
    const syncState = fakeSyncState();

    const result = await useCase({ chunks, embeddings, vectorIndex, syncState }).execute();

    assert.strictEqual(result.embedded, BATCH_SIZE + 1);
    assert.deepStrictEqual(embeddings.calls, [BATCH_SIZE, 1]);
    assert.strictEqual(vectorIndex.batches.length, 2);
    assert.strictEqual(syncState.get(HIGH_WATER_MARK_KEY), String(BATCH_SIZE + 1));
  });

  await t.test('a failure partway through preserves progress already made — resumable, not lost', async () => {
    const chunks = Array.from({ length: BATCH_SIZE + 1 }, (_, i) => fakeChunk(i + 1));
    const vectorIndex = fakeVectorIndex({ failOnBatch: 2 });
    const syncState = fakeSyncState();

    await assert.rejects(
      () => useCase({ chunks, vectorIndex, syncState }).execute(),
      /simulated failure on batch 2/
    );

    // The first batch's mark was committed before the second batch's failure.
    assert.strictEqual(syncState.get(HIGH_WATER_MARK_KEY), String(BATCH_SIZE));
    assert.strictEqual(vectorIndex.batches.length, 1);
  });

  await t.test('each point is keyed by chunk id, ready for an idempotent re-sync', async () => {
    const chunks = [fakeChunk(10)];
    const vectorIndex = fakeVectorIndex();

    await useCase({ chunks, vectorIndex }).execute();

    assert.strictEqual(vectorIndex.batches[0][0].id, 10);
    assert.deepStrictEqual(vectorIndex.batches[0][0].vector, [0, 0, 0, 1]);
    assert.strictEqual(vectorIndex.batches[0][0].payload.source_table, 'chunks');
  });
});
