/**
 * Unit tests: ManageDocumentsUseCase — list/delete against the real store.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { ManageDocumentsUseCase } = require('../src/application/useCases/ManageDocumentsUseCase');
const { DocumentRepositorySqlite } = require('../src/infrastructure/documents/DocumentRepositorySqlite');
const { JsonLineLogger } = require('../src/infrastructure/logging/JsonLineLogger');

const silentLogger = new JsonLineLogger({ level: 'error', sink: () => {} });

function unit(values) {
  const v = Float32Array.from(values);
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

function seed(documents, docId, overrides = {}) {
  documents.insertDocument({
    docId,
    fileName: `${docId}.pdf`,
    mimeType: 'application/pdf',
    byteSize: 2048,
    pageCount: 3,
    chunkCount: 0,
    embedModel: 'text-embedding-3-small',
    dimensions: 4,
    status: 'indexing',
    errorMessage: null,
    uploadedAt: '2026-09-07T10:00:00.000Z',
    contentHash: `hash-${docId}`,
    meetingId: null,
    ...overrides,
  });
  return documents;
}

function makeUseCase() {
  const documents = new DocumentRepositorySqlite(':memory:');
  return { documents, useCase: new ManageDocumentsUseCase({ documents, logger: silentLogger }) };
}

test('list maps rows to the protocol shape', () => {
  const { documents, useCase } = makeUseCase();
  seed(documents, 'd1');
  documents.markReady('d1', { chunkCount: 12, pageCount: 3 });

  const [doc] = useCase.list();
  assert.deepStrictEqual(
    Object.keys(doc).sort(),
    ['bytes', 'chunkCount', 'docId', 'errorMessage', 'fileName', 'pageCount', 'status', 'uploadedAt'],
  );
  assert.strictEqual(doc.docId, 'd1');
  assert.strictEqual(doc.bytes, 2048);
  assert.strictEqual(doc.chunkCount, 12);
  assert.strictEqual(doc.status, 'ready');
});

test('list is empty, not an error, on a fresh store', () => {
  const { useCase } = makeUseCase();
  assert.deepStrictEqual(useCase.list(), []);
});

test('a failed document is listed with its reason', () => {
  const { documents, useCase } = makeUseCase();
  seed(documents, 'd1');
  documents.markFailed('d1', 'No readable text found');

  const [doc] = useCase.list();
  assert.strictEqual(doc.status, 'failed');
  assert.match(doc.errorMessage, /No readable text/);
});

test('remove deletes the document and its chunks', () => {
  const { documents, useCase } = makeUseCase();
  seed(documents, 'd1');
  documents.insertChunks('d1', [
    { chunkIndex: 0, pageNumber: 1, charStart: 0, charEnd: 5, text: 'hello', embedding: unit([1, 0, 0, 0]) },
  ]);
  documents.markReady('d1', { chunkCount: 1, pageCount: 1 });
  assert.strictEqual(documents.searchByVector(unit([1, 0, 0, 0]), { minSimilarity: 0 }).length, 1);

  assert.deepStrictEqual(useCase.remove('d1'), { docId: 'd1' });
  assert.strictEqual(documents.getDocument('d1'), null);
  // ON DELETE CASCADE: the chunks must not outlive the document.
  assert.strictEqual(documents.searchByVector(unit([1, 0, 0, 0]), { minSimilarity: 0 }).length, 0);
});

test('removing an unknown document is a typed error', () => {
  const { useCase } = makeUseCase();
  assert.throws(() => useCase.remove('nope'), (err) => err.code === 'DOCUMENT_NOT_FOUND');
});

test('remove requires a docId', () => {
  const { useCase } = makeUseCase();
  assert.throws(() => useCase.remove(''), (err) => err.code === 'DOCUMENT_INVALID_REQUEST');
  assert.throws(() => useCase.remove(undefined), (err) => err.code === 'DOCUMENT_INVALID_REQUEST');
});

test('remove frees library capacity', () => {
  const { documents, useCase } = makeUseCase();
  seed(documents, 'd1');
  seed(documents, 'd2');
  assert.strictEqual(documents.stats().count, 2);
  useCase.remove('d1');
  assert.strictEqual(documents.stats().count, 1);
  assert.strictEqual(documents.stats().totalBytes, 2048);
});

test('a document still indexing is not searchable', () => {
  const { documents } = makeUseCase();
  seed(documents, 'd1'); // status 'indexing'
  documents.insertChunks('d1', [
    { chunkIndex: 0, pageNumber: 1, charStart: 0, charEnd: 5, text: 'hello', embedding: unit([1, 0, 0, 0]) },
  ]);
  // Half a document must never answer a question.
  assert.strictEqual(documents.searchByVector(unit([1, 0, 0, 0]), { minSimilarity: 0 }).length, 0);
  documents.markReady('d1', { chunkCount: 1, pageCount: 1 });
  assert.strictEqual(documents.searchByVector(unit([1, 0, 0, 0]), { minSimilarity: 0 }).length, 1);
});
