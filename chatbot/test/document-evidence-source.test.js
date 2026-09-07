/**
 * Unit tests: DocumentEvidenceSource — similarity floor, hit shape, and the
 * empty-corpus short circuit. The EmbeddingGateway is a fake, so no network
 * call happens; the repository is a real ':memory:' store.
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  DocumentEvidenceSource,
} = require('../src/infrastructure/documents/DocumentEvidenceSource');
const {
  DocumentRepositorySqlite,
} = require('../src/infrastructure/documents/DocumentRepositorySqlite');
const { MIN_COSINE_SIMILARITY } = require('../src/application/graph/constants');

function unit(values) {
  const v = Float32Array.from(values);
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** Returns a fixed vector and counts calls, so cost behaviour is assertable. */
function fakeEmbeddings(vector = unit([1, 0, 0, 0])) {
  const calls = [];
  return {
    calls,
    model: () => 'fake-embed',
    dimensions: () => vector.length,
    embedBatch: async (texts) => texts.map(() => vector),
    embedOne: async (text, opts) => {
      calls.push({ text, tag: opts && opts.tag });
      return vector;
    },
  };
}

/** A store holding three chunks at known angles from [1,0,0,0]. */
function seededRepo() {
  const repo = new DocumentRepositorySqlite(':memory:');
  repo.insertDocument({
    docId: 'doc-a',
    fileName: 'spec.pdf',
    mimeType: 'application/pdf',
    byteSize: 2048,
    pageCount: 4,
    embedModel: 'fake-embed',
    dimensions: 4,
    status: 'indexing',
    uploadedAt: '2026-09-07T00:00:00.000Z',
    contentHash: 'hash-a',
  });
  repo.insertChunks('doc-a', [
    { chunkIndex: 0, pageNumber: 4, charStart: 0, charEnd: 10, text: 'exact match', embedding: unit([1, 0, 0, 0]) },
    { chunkIndex: 1, pageNumber: 2, charStart: 10, charEnd: 20, text: 'partial match', embedding: unit([1, 1, 0, 0]) },
    { chunkIndex: 2, pageNumber: 1, charStart: 20, charEnd: 30, text: 'unrelated', embedding: unit([0, 0, 1, 0]) },
  ]);
  repo.markReady('doc-a', { chunkCount: 3, pageCount: 4 });
  return repo;
}

const sourceFor = (repo, embeddings, extra = {}) =>
  new DocumentEvidenceSource({ documents: repo, embeddings, ...extra });

test('empty or missing question makes no request', async () => {
  const repo = seededRepo();
  const embeddings = fakeEmbeddings();
  const source = sourceFor(repo, embeddings);

  assert.deepStrictEqual(await source.search({ question: '' }), []);
  assert.deepStrictEqual(await source.search({ question: '   ' }), []);
  assert.deepStrictEqual(await source.search({}), []);
  assert.strictEqual(embeddings.calls.length, 0);
  repo.close();
});

test('an empty corpus short-circuits BEFORE embedding', async () => {
  // Every question would otherwise pay for a query embedding for the entire
  // life of an install that has no documents.
  const repo = new DocumentRepositorySqlite(':memory:');
  const embeddings = fakeEmbeddings();

  const hits = await sourceFor(repo, embeddings).search({ question: 'anything', limit: 5 });

  assert.deepStrictEqual(hits, []);
  assert.strictEqual(embeddings.calls.length, 0, 'no embedding was requested');
  repo.close();
});

test('the similarity floor drops noise', async (t) => {
  await t.test('orthogonal chunks are excluded by the default floor', async () => {
    const repo = seededRepo();
    const hits = await sourceFor(repo, fakeEmbeddings()).search({ question: 'q', limit: 10 });
    assert.deepStrictEqual(hits.map((h) => h.text), ['exact match', 'partial match']);
    assert.ok(hits.every((h) => h.score >= MIN_COSINE_SIMILARITY));
    repo.close();
  });

  await t.test('a floor of 0 lets everything through', async () => {
    const repo = seededRepo();
    const source = sourceFor(repo, fakeEmbeddings(), { minSimilarity: 0 });
    const hits = await source.search({ question: 'q', limit: 10 });
    assert.strictEqual(hits.length, 3);
    repo.close();
  });

  await t.test('a strict floor can exclude everything but the exact match', async () => {
    const repo = seededRepo();
    const source = sourceFor(repo, fakeEmbeddings(), { minSimilarity: 0.99 });
    const hits = await source.search({ question: 'q', limit: 10 });
    assert.deepStrictEqual(hits.map((h) => h.text), ['exact match']);
    repo.close();
  });
});

test('hit shape', async (t) => {
  const repo = seededRepo();
  const [hit] = await sourceFor(repo, fakeEmbeddings()).search({ question: 'q', limit: 1 });

  await t.test('carries the fields a document citation needs', () => {
    assert.strictEqual(hit.sourceType, 'document');
    assert.strictEqual(hit.groupKey, 'doc:doc-a');
    assert.strictEqual(hit.docId, 'doc-a');
    assert.strictEqual(hit.fileName, 'spec.pdf');
    assert.strictEqual(hit.pageNumber, 4);
    assert.strictEqual(hit.text, 'exact match');
  });

  await t.test('stays structurally compatible with meeting hits', () => {
    // The existing evidence path dedupes on meetingId:sourceTable:sourceId, so
    // these must be present rather than undefined.
    assert.strictEqual(hit.meetingId, null);
    assert.strictEqual(hit.meetingDate, '');
    assert.strictEqual(hit.speaker, '');
    assert.strictEqual(hit.sourceTable, 'documents');
    assert.strictEqual(hit.sourceId, 'doc-a:0');
  });

  await t.test('does NOT assign a citation ref', () => {
    // `ref` (M3 / D2) is scoped to one answer, so it is assigned while
    // evidence is bounded — not by the source, which has no answer scope.
    assert.strictEqual(hit.ref, undefined);
  });

  await t.test('score is the cosine similarity', () => {
    assert.ok(Math.abs(hit.score - 1) < 1e-6, `got ${hit.score}`);
  });

  repo.close();
});

test('the query embedding is tagged for cost attribution', async () => {
  const repo = seededRepo();
  const embeddings = fakeEmbeddings();
  await sourceFor(repo, embeddings).search({ question: 'what did we decide?' });

  assert.strictEqual(embeddings.calls.length, 1, 'one embedding per question');
  assert.strictEqual(embeddings.calls[0].tag, 'embed_query');
  assert.strictEqual(embeddings.calls[0].text, 'what did we decide?');
  repo.close();
});

test('results are ordered best-first and respect the limit', async () => {
  const repo = seededRepo();
  const source = sourceFor(repo, fakeEmbeddings(), { minSimilarity: 0 });

  const hits = await source.search({ question: 'q', limit: 2 });
  assert.strictEqual(hits.length, 2);
  assert.ok(hits[0].score >= hits[1].score, 'descending by similarity');
  repo.close();
});

test('an indexing document is not searched', async () => {
  const repo = new DocumentRepositorySqlite(':memory:');
  repo.insertDocument({
    docId: 'half',
    fileName: 'wip.pdf',
    mimeType: 'application/pdf',
    byteSize: 10,
    pageCount: 1,
    embedModel: 'fake-embed',
    dimensions: 4,
    status: 'indexing',
    uploadedAt: '2026-09-07T00:00:00.000Z',
    contentHash: 'h',
  });
  repo.insertChunks('half', [
    { chunkIndex: 0, pageNumber: 1, charStart: 0, charEnd: 5, text: 'partial', embedding: unit([1, 0, 0, 0]) },
  ]);

  // stats() counts the row, so embedding DOES happen — but the chunk is not
  // returned, because answering from a half-indexed document without saying so
  // would be worse than returning nothing.
  const hits = await sourceFor(repo, fakeEmbeddings()).search({ question: 'q' });
  assert.deepStrictEqual(hits, []);
  repo.close();
});
