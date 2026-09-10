/**
 * Unit tests: EpisodicMemoryEvidenceSource — similarity floor, hit shape,
 * and recency/importance re-ranking. VectorIndex/EmbeddingGateway/ChunkStore
 * are all fakes, so no network call happens — same convention as
 * document-evidence-source.test.js.
 */
const test = require('node:test');
const assert = require('node:assert');

const { EpisodicMemoryEvidenceSource } = require('../src/infrastructure/vectorstore/EpisodicMemoryEvidenceSource');

const SCORING = { wRelevance: 0.6, wImportance: 0.25, wRecency: 0.15, recencyHalflifeDays: 14 };

function fakeEmbeddings() {
  const calls = [];
  return {
    calls,
    embedOne: async (text, opts) => {
      calls.push({ text, tag: opts && opts.tag });
      return [1, 0, 0, 0];
    },
  };
}

function fakeVectorIndex(hits) {
  const searchCalls = [];
  return {
    searchCalls,
    search: async (vector, opts) => {
      searchCalls.push({ vector, opts });
      return hits;
    },
  };
}

function fakeChunkStore(rowsById) {
  return { chunksByIds: (ids) => ids.map((id) => rowsById.get(id)).filter(Boolean) };
}

function row(id, overrides = {}) {
  return {
    id,
    meetingId: 100 + id,
    meetingStartTime: '2026-08-20T09:55:00.000Z',
    speaker: 'Speaker A',
    text: `chunk ${id}`,
    ...overrides,
  };
}

function vecHit(id, overrides = {}) {
  return {
    id,
    similarity: 0.9,
    payload: { importance: 0.6, created_at: '2026-08-20T10:00:00.000Z' },
    ...overrides,
  };
}

test('EpisodicMemoryEvidenceSource', async (t) => {
  await t.test('an empty/blank question short-circuits without embedding', async () => {
    const embeddings = fakeEmbeddings();
    const source = new EpisodicMemoryEvidenceSource({
      vectorIndex: fakeVectorIndex([]),
      embeddings,
      chunkStore: fakeChunkStore(new Map()),
      scoring: SCORING,
    });

    assert.deepStrictEqual(await source.search({ question: '' }), []);
    assert.deepStrictEqual(await source.search({ question: '   ' }), []);
    assert.strictEqual(embeddings.calls.length, 0);
  });

  await t.test('no vector hits: returns empty without hitting the chunk store', async () => {
    const source = new EpisodicMemoryEvidenceSource({
      vectorIndex: fakeVectorIndex([]),
      embeddings: fakeEmbeddings(),
      chunkStore: fakeChunkStore(new Map()),
      scoring: SCORING,
    });

    assert.deepStrictEqual(await source.search({ question: 'what did we decide' }), []);
  });

  await t.test('embeds the question with the embed_query tag, same as DocumentEvidenceSource', async () => {
    const embeddings = fakeEmbeddings();
    const source = new EpisodicMemoryEvidenceSource({
      vectorIndex: fakeVectorIndex([]),
      embeddings,
      chunkStore: fakeChunkStore(new Map()),
      scoring: SCORING,
    });

    await source.search({ question: 'what did we decide' });
    assert.strictEqual(embeddings.calls[0].tag, 'embed_query');
  });

  await t.test('passes minSimilarity and the project filter through to the vector index', async () => {
    const vectorIndex = fakeVectorIndex([]);
    const source = new EpisodicMemoryEvidenceSource({
      vectorIndex,
      embeddings: fakeEmbeddings(),
      chunkStore: fakeChunkStore(new Map()),
      minSimilarity: 0.42,
      scoring: SCORING,
    });

    await source.search({ question: 'q', projectId: 7 });
    assert.strictEqual(vectorIndex.searchCalls[0].opts.minSimilarity, 0.42);
    assert.deepStrictEqual(vectorIndex.searchCalls[0].opts.filter, { projectId: 7 });
  });

  await t.test('maps hits to the shared EvidenceHit shape — sourceType meeting, groupKey meeting:{id}', async () => {
    const rows = new Map([[1, row(1)]]);
    const source = new EpisodicMemoryEvidenceSource({
      vectorIndex: fakeVectorIndex([vecHit(1)]),
      embeddings: fakeEmbeddings(),
      chunkStore: fakeChunkStore(rows),
      scoring: SCORING,
    });

    const [hit] = await source.search({ question: 'q' });
    assert.strictEqual(hit.sourceType, 'meeting');
    assert.strictEqual(hit.groupKey, 'meeting:101');
    assert.strictEqual(hit.sourceTable, 'chunks');
    assert.strictEqual(hit.sourceId, 1);
    assert.strictEqual(hit.meetingId, 101);
    assert.strictEqual(hit.meetingDate, '2026-08-20T09:55:00.000Z');
    assert.strictEqual(hit.speaker, 'Speaker A');
    assert.strictEqual(hit.text, 'chunk 1');
    assert.ok(Number.isFinite(hit.score));
  });

  await t.test('re-ranks by compositeScore, not raw vector-search order', async () => {
    // Vector search returns id 1 first (higher raw similarity), but id 2's
    // higher importance + recency should let it win after re-ranking.
    const hits = [
      vecHit(1, { similarity: 0.80, payload: { importance: 0.3, created_at: '2026-06-01T00:00:00.000Z' } }),
      vecHit(2, { similarity: 0.79, payload: { importance: 1.0, created_at: '2026-09-08T00:00:00.000Z' } }),
    ];
    const rows = new Map([[1, row(1)], [2, row(2)]]);
    const source = new EpisodicMemoryEvidenceSource({
      vectorIndex: fakeVectorIndex(hits),
      embeddings: fakeEmbeddings(),
      chunkStore: fakeChunkStore(rows),
      scoring: SCORING,
    });

    const results = await source.search({ question: 'q' });
    assert.strictEqual(results[0].sourceId, 2, 'the more important, more recent chunk should rank first');
  });

  await t.test('a vector hit with no matching chunk row (deleted/renamed) is dropped, not crashed on', async () => {
    const rows = new Map([[1, row(1)]]); // id 2 deliberately missing
    const source = new EpisodicMemoryEvidenceSource({
      vectorIndex: fakeVectorIndex([vecHit(1), vecHit(2)]),
      embeddings: fakeEmbeddings(),
      chunkStore: fakeChunkStore(rows),
      scoring: SCORING,
    });

    const results = await source.search({ question: 'q' });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].sourceId, 1);
  });
});
