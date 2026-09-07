/**
 * Unit tests: IndexDocumentUseCase — the upload pipeline against the REAL
 * document store (':memory:') with a fake embedding gateway. No network.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { IndexDocumentUseCase } = require('../src/application/useCases/IndexDocumentUseCase');
const { DocumentRepositorySqlite } = require('../src/infrastructure/documents/DocumentRepositorySqlite');
const { createParserRegistry } = require('../src/infrastructure/documents/parsers/parserRegistry');
const { JsonLineLogger } = require('../src/infrastructure/logging/JsonLineLogger');

const silentLogger = new JsonLineLogger({ level: 'error', sink: () => {} });

/** Deterministic unit vectors — no network, no OpenAI. */
class FakeEmbeddings {
  constructor({ dims = 8, failOn = null } = {}) {
    this.dims = dims;
    this.failOn = failOn; // batch index to blow up on; 0 means the first
    this.batches = [];
    this.embedded = 0;
  }
  model() { return 'fake-embed'; }
  dimensions() { return this.dims; }
  async embedBatch(texts) {
    if (this.failOn !== null && this.batches.length === this.failOn) {
      throw Object.assign(new Error('embedding provider exploded'), { code: 'EMBED_FAILED' });
    }
    this.batches.push(texts.length);
    this.embedded += texts.length;
    return texts.map((t, i) => {
      const v = new Float32Array(this.dims);
      v[(t.length + i) % this.dims] = 1; // already unit length
      return v;
    });
  }
  async embedOne(text) { return (await this.embedBatch([text]))[0]; }
}

let tmp;
function tmpFile(name, content) {
  if (!tmp) tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-index-test-'));
  const p = path.join(tmp, name);
  fs.writeFileSync(p, content);
  return p;
}

function makeUseCase({ embeddings = new FakeEmbeddings(), limits = {} } = {}) {
  const documents = new DocumentRepositorySqlite(':memory:');
  const useCase = new IndexDocumentUseCase({
    documents,
    embeddings,
    parsers: createParserRegistry(),
    logger: silentLogger,
    limits: {
      maxDocumentBytes: 20 * 1024 * 1024,
      maxLibraryBytes: 200 * 1024 * 1024,
      maxDocuments: 50,
      ...limits,
    },
  });
  return { useCase, documents, embeddings };
}

test('indexes a text file end to end and marks it ready', async () => {
  const { useCase, documents } = makeUseCase();
  const filePath = tmpFile('notes.txt', 'The team chose SQLite.\n\nRetries use exponential backoff.');

  const result = await useCase.execute({ docId: 'd1', filePath, fileName: 'notes.txt' });

  assert.strictEqual(result.docId, 'd1');
  assert.strictEqual(result.deduped, false);
  assert.ok(result.chunkCount >= 1);

  const row = documents.getDocument('d1');
  assert.strictEqual(row.status, 'ready');
  assert.strictEqual(row.chunkCount, result.chunkCount);
  assert.strictEqual(row.embedModel, 'fake-embed');
  assert.strictEqual(row.dimensions, 8);
  assert.strictEqual(row.fileName, 'notes.txt');
  assert.strictEqual(row.mimeType, 'text/plain');
});

test('the indexed document is immediately searchable', async () => {
  const { useCase, documents, embeddings } = makeUseCase();
  const filePath = tmpFile('searchable.txt', 'We chose SQLite for the local database.');
  await useCase.execute({ docId: 'd1', filePath, fileName: 'searchable.txt' });

  const query = await embeddings.embedOne('We chose SQLite for the local database.');
  const hits = documents.searchByVector(query, { limit: 5, minSimilarity: 0 });
  assert.ok(hits.length >= 1);
  assert.strictEqual(hits[0].docId, 'd1');
  assert.strictEqual(hits[0].fileName, 'searchable.txt');
});

test('progress is reported for every phase, and embed progress advances', async () => {
  const { useCase } = makeUseCase();
  // Long enough to chunk into several passages.
  const filePath = tmpFile('long.txt', Array.from({ length: 40 }, (_, i) => `Paragraph ${i} about the payment webhook and its retry policy.`).join('\n\n'));

  const events = [];
  await useCase.execute({ docId: 'd1', filePath, onProgress: (p) => events.push(p) });

  const phases = events.map((e) => e.phase);
  assert.deepStrictEqual([...new Set(phases)], ['parse', 'chunk', 'embed', 'store']);

  const embeds = events.filter((e) => e.phase === 'embed');
  assert.strictEqual(embeds[0].done, 0);
  assert.strictEqual(embeds[embeds.length - 1].done, embeds[0].total);
  assert.ok(embeds.every((e) => e.total > 0));
});

test('re-uploading the same content dedupes instead of hitting the unique index', async () => {
  const { useCase, documents, embeddings } = makeUseCase();
  const filePath = tmpFile('dupe.txt', 'Identical content for both uploads.');

  const first = await useCase.execute({ docId: 'd1', filePath, fileName: 'dupe.txt' });
  const embeddedAfterFirst = embeddings.embedded;

  // A different docId and file name, same bytes.
  const copyPath = tmpFile('dupe-copy.txt', 'Identical content for both uploads.');
  const second = await useCase.execute({ docId: 'd2', filePath: copyPath, fileName: 'dupe-copy.txt' });

  assert.strictEqual(second.deduped, true);
  assert.strictEqual(second.docId, first.docId);
  // The whole point: no re-embedding, so no second bill.
  assert.strictEqual(embeddings.embedded, embeddedAfterFirst);
  assert.strictEqual(documents.listDocuments().length, 1);
  assert.strictEqual(documents.getDocument('d2'), null);
});

test('a failed upload can be retried: the incomplete row does not own the hash forever', async () => {
  const embeddings = new FakeEmbeddings({ failOn: 0 });
  const { useCase, documents } = makeUseCase({ embeddings });
  const filePath = tmpFile('retry.txt', 'Content that fails the first time.');

  await assert.rejects(() => useCase.execute({ docId: 'd1', filePath }), /exploded/);
  assert.strictEqual(documents.getDocument('d1').status, 'failed');

  // Same bytes again, now that embedding works.
  embeddings.failOn = null;
  const result = await useCase.execute({ docId: 'd2', filePath });
  assert.strictEqual(result.deduped, false);
  assert.strictEqual(documents.getDocument('d2').status, 'ready');
  assert.strictEqual(documents.getDocument('d1'), null);
});

test('a failure records why on the row, not only in the thrown error', async () => {
  const { useCase, documents } = makeUseCase({ embeddings: new FakeEmbeddings({ failOn: 0 }) });
  const filePath = tmpFile('fails.txt', 'Some content.');

  await assert.rejects(() => useCase.execute({ docId: 'd1', filePath }));
  const row = documents.getDocument('d1');
  assert.strictEqual(row.status, 'failed');
  assert.match(row.errorMessage, /exploded/);
});

test('an unsupported extension is rejected before any row is written', async () => {
  const { useCase, documents } = makeUseCase();
  const filePath = tmpFile('archive.zip', 'not really a zip');

  await assert.rejects(
    () => useCase.execute({ docId: 'd1', filePath, fileName: 'archive.zip' }),
    (err) => err.code === 'DOCUMENT_UNSUPPORTED_TYPE' && /Supported:/.test(err.message),
  );
  assert.strictEqual(documents.getDocument('d1'), null);
});

test('a missing file is a typed error, not an ENOENT crash', async () => {
  const { useCase } = makeUseCase();
  await assert.rejects(
    () => useCase.execute({ docId: 'd1', filePath: '/no/such/file.txt' }),
    (err) => err.code === 'DOCUMENT_NOT_FOUND',
  );
});

test('an oversized file is rejected with both sizes in the message', async () => {
  const { useCase, documents } = makeUseCase({ limits: { maxDocumentBytes: 32 } });
  const filePath = tmpFile('big.txt', 'x'.repeat(1024));

  await assert.rejects(
    () => useCase.execute({ docId: 'd1', filePath }),
    (err) => err.code === 'DOCUMENT_TOO_LARGE',
  );
  assert.strictEqual(documents.getDocument('d1'), null);
});

test('an empty file is rejected as having no text', async () => {
  const { useCase } = makeUseCase();
  const filePath = tmpFile('empty.txt', '');
  await assert.rejects(
    () => useCase.execute({ docId: 'd1', filePath }),
    (err) => err.code === 'DOCUMENT_NO_TEXT',
  );
});

test('the library count cap is enforced', async () => {
  const { useCase } = makeUseCase({ limits: { maxDocuments: 1 } });
  await useCase.execute({ docId: 'd1', filePath: tmpFile('one.txt', 'First document.') });

  await assert.rejects(
    () => useCase.execute({ docId: 'd2', filePath: tmpFile('two.txt', 'Second document.') }),
    (err) => err.code === 'DOCUMENT_LIBRARY_FULL' && /Remove one first/.test(err.message),
  );
});

test('the library byte cap is enforced against the running total', async () => {
  const { useCase } = makeUseCase({ limits: { maxLibraryBytes: 60 } });
  await useCase.execute({ docId: 'd1', filePath: tmpFile('a.txt', 'x'.repeat(40)) });

  await assert.rejects(
    () => useCase.execute({ docId: 'd2', filePath: tmpFile('b.txt', 'y'.repeat(40)) }),
    (err) => err.code === 'DOCUMENT_LIBRARY_FULL',
  );
});

test('docId and filePath are required', async () => {
  const { useCase } = makeUseCase();
  await assert.rejects(() => useCase.execute({ filePath: '/x.txt' }), (e) => e.code === 'DOCUMENT_INVALID_REQUEST');
  await assert.rejects(() => useCase.execute({ docId: 'd1' }), (e) => e.code === 'DOCUMENT_INVALID_REQUEST');
});

test('fileName defaults to the basename of the path', async () => {
  const { useCase, documents } = makeUseCase();
  const filePath = tmpFile('inferred.md', '# Title\n\nSome markdown body.');
  await useCase.execute({ docId: 'd1', filePath });
  assert.strictEqual(documents.getDocument('d1').fileName, 'inferred.md');
  assert.strictEqual(documents.getDocument('d1').mimeType, 'text/markdown');
});

test('chunks are embedded in batches, one request per batch', async () => {
  const { useCase, embeddings } = makeUseCase();
  const filePath = tmpFile('batched.txt', Array.from({ length: 200 }, (_, i) => `Paragraph number ${i} discussing retries, webhooks and timeouts at length.`).join('\n\n'));

  const result = await useCase.execute({ docId: 'd1', filePath });
  assert.strictEqual(embeddings.embedded, result.chunkCount);
  assert.strictEqual(embeddings.batches.reduce((a, b) => a + b, 0), result.chunkCount);
  assert.ok(embeddings.batches.every((n) => n <= 64));
});
