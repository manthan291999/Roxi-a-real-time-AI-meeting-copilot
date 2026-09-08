/**
 * Unit tests: the document store — vector round-trip, cosine ranking,
 * cascade delete and content-hash dedupe. All against ':memory:', no network.
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  DocumentRepositorySqlite,
  encodeVector,
  decodeVector,
} = require('../src/infrastructure/documents/DocumentRepositorySqlite');

/** L2-normalize, which is the invariant the store depends on. */
function unit(values) {
  const v = Float32Array.from(values);
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

function repo() {
  return new DocumentRepositorySqlite(':memory:');
}

function doc(overrides = {}) {
  return {
    docId: 'd1',
    fileName: 'spec.pdf',
    mimeType: 'application/pdf',
    byteSize: 1024,
    pageCount: 2,
    chunkCount: 0,
    embedModel: 'text-embedding-3-small',
    dimensions: 4,
    status: 'indexing',
    errorMessage: null,
    uploadedAt: '2026-09-07T10:00:00.000Z',
    contentHash: 'hash-a',
    projectId: null,
    ...overrides,
  };
}

function chunk(i, embedding, text = `chunk ${i}`) {
  return {
    chunkIndex: i,
    pageNumber: i + 1,
    charStart: i * 100,
    charEnd: i * 100 + 90,
    text,
    embedding,
  };
}

test('vector encoding is bit-exact', () => {
  const v = unit([0.5, -0.25, 0.125, 1]);
  const round = decodeVector(encodeVector(v));
  assert.strictEqual(round.length, v.length);
  for (let i = 0; i < v.length; i++) {
    assert.strictEqual(round[i], v[i], `component ${i} changed`);
  }
});

test('document lifecycle', async (t) => {
  await t.test('insert then read back', () => {
    const r = repo();
    r.insertDocument(doc());
    const got = r.getDocument('d1');
    assert.strictEqual(got.fileName, 'spec.pdf');
    assert.strictEqual(got.status, 'indexing');
    assert.strictEqual(got.dimensions, 4);
    assert.strictEqual(got.projectId, null, 'global by default');
    r.close();
  });

  await t.test('a document can be filed under a project', () => {
    const r = repo();
    r.insertDocument(doc({ projectId: 7 }));
    assert.strictEqual(r.getDocument('d1').projectId, 7);
    r.close();
  });

  await t.test('a zero or junk project id is stored as global, not as a scope nothing matches', () => {
    const r = repo();
    r.insertDocument(doc({ docId: 'z', contentHash: 'h-z', projectId: 0 }));
    r.insertDocument(doc({ docId: 'j', contentHash: 'h-j', projectId: 'oops' }));
    assert.strictEqual(r.getDocument('z').projectId, null);
    assert.strictEqual(r.getDocument('j').projectId, null);
    r.close();
  });

  await t.test('unknown id is null, not a throw', () => {
    const r = repo();
    assert.strictEqual(r.getDocument('nope'), null);
    r.close();
  });

  await t.test('markReady flips status and records counts', () => {
    const r = repo();
    r.insertDocument(doc());
    r.markReady('d1', { chunkCount: 7, pageCount: 3 });
    const got = r.getDocument('d1');
    assert.strictEqual(got.status, 'ready');
    assert.strictEqual(got.chunkCount, 7);
    assert.strictEqual(got.pageCount, 3);
    r.close();
  });

  await t.test('markFailed records a truncated reason', () => {
    const r = repo();
    r.insertDocument(doc());
    r.markFailed('d1', 'x'.repeat(900));
    const got = r.getDocument('d1');
    assert.strictEqual(got.status, 'failed');
    assert.strictEqual(got.errorMessage.length, 500);
    r.close();
  });

  await t.test('stats count bytes across documents', () => {
    const r = repo();
    r.insertDocument(doc({ docId: 'a', contentHash: 'h-a', byteSize: 100 }));
    r.insertDocument(doc({ docId: 'b', contentHash: 'h-b', byteSize: 250 }));
    assert.deepStrictEqual(r.stats(), { count: 2, totalBytes: 350 });
    r.close();
  });
});

test('content_hash dedupes a re-upload of the same file', () => {
  const r = repo();
  r.insertDocument(doc({ docId: 'first', contentHash: 'same' }));

  assert.strictEqual(r.findByContentHash('same').docId, 'first');
  assert.strictEqual(r.findByContentHash('other'), null);

  // The unique index is what makes the caller's dedupe check load-bearing
  // rather than advisory.
  assert.throws(
    () => r.insertDocument(doc({ docId: 'second', contentHash: 'same' })),
    /UNIQUE|constraint/i,
  );
  r.close();
});

test('cosine ranking over a hand-built corpus', async (t) => {
  // Four orthogonal axes, so every expected similarity is obvious by hand.
  const east = unit([1, 0, 0, 0]);
  const north = unit([0, 1, 0, 0]);
  const diagonal = unit([1, 1, 0, 0]); // 45 degrees from each

  function ready() {
    const r = repo();
    r.insertDocument(doc({ docId: 'd1', contentHash: 'h1' }));
    r.insertChunks('d1', [
      chunk(0, east, 'due east'),
      chunk(1, north, 'due north'),
      chunk(2, diagonal, 'north east'),
    ]);
    r.markReady('d1', { chunkCount: 3, pageCount: 2 });
    return r;
  }

  await t.test('ranks the exact match first and scores it 1.0', () => {
    const r = ready();
    const hits = r.searchByVector(east, { limit: 3 });
    assert.strictEqual(hits.length, 3);
    assert.strictEqual(hits[0].text, 'due east');
    assert.ok(Math.abs(hits[0].similarity - 1) < 1e-6, `got ${hits[0].similarity}`);
    r.close();
  });

  await t.test('ranks 45 degrees above orthogonal', () => {
    const r = ready();
    const hits = r.searchByVector(east, { limit: 3 });
    assert.strictEqual(hits[1].text, 'north east');
    assert.ok(Math.abs(hits[1].similarity - Math.SQRT1_2) < 1e-6, `got ${hits[1].similarity}`);
    assert.ok(Math.abs(hits[2].similarity) < 1e-6, 'orthogonal scores ~0');
    r.close();
  });

  await t.test('minSimilarity filters the tail', () => {
    const r = ready();
    const hits = r.searchByVector(east, { limit: 10, minSimilarity: 0.5 });
    assert.deepStrictEqual(hits.map((h) => h.text), ['due east', 'north east']);
    r.close();
  });

  await t.test('limit is respected', () => {
    const r = ready();
    assert.strictEqual(r.searchByVector(east, { limit: 1 }).length, 1);
    r.close();
  });

  await t.test('hits carry the fields a citation needs', () => {
    const r = ready();
    const [hit] = r.searchByVector(east, { limit: 1 });
    assert.strictEqual(hit.docId, 'd1');
    assert.strictEqual(hit.fileName, 'spec.pdf');
    assert.strictEqual(hit.pageNumber, 1);
    assert.strictEqual(hit.chunkId, 'd1:0');
    r.close();
  });

  await t.test('an empty query vector returns nothing', () => {
    const r = ready();
    assert.deepStrictEqual(r.searchByVector(new Float32Array(0)), []);
    assert.deepStrictEqual(r.searchByVector(null), []);
    r.close();
  });
});

test('project scope', async (t) => {
  const east = unit([1, 0, 0, 0]);

  /**
   * Three documents at the same angle, differing only in scope: one global,
   * one in project 1, one in project 2. Identical vectors on purpose — scope is
   * then the only thing that can change a result.
   */
  function scoped() {
    const r = repo();
    for (const [docId, projectId, text] of [
      ['global', null, 'global template'],
      ['p1', 1, 'project one contract'],
      ['p2', 2, 'project two contract'],
    ]) {
      r.insertDocument(doc({ docId, contentHash: `h-${docId}`, projectId }));
      r.insertChunks(docId, [chunk(0, east, text)]);
      r.markReady(docId, { chunkCount: 1, pageCount: 1 });
    }
    return r;
  }

  await t.test('an unscoped search sees the whole library', () => {
    const r = scoped();
    assert.strictEqual(r.searchByVector(east, { limit: 10 }).length, 3);
    r.close();
  });

  await t.test('a scoped search sees its own project plus the global documents', () => {
    const r = scoped();
    const texts = r
      .searchByVector(east, { limit: 10, projectId: 1 })
      .map((h) => h.text)
      .sort();
    assert.deepStrictEqual(texts, ['global template', 'project one contract']);
    r.close();
  });

  // The reason scope is pushed into SQL rather than applied to the results:
  // searchByVector truncates to `limit`, so filtering afterwards would let
  // out-of-scope chunks consume slots and silently shrink the answer.
  await t.test('out-of-scope documents do not consume result slots', () => {
    const r = scoped();
    const hits = r.searchByVector(east, { limit: 2, projectId: 1 });
    assert.strictEqual(hits.length, 2, 'both in-scope documents must survive the limit');
    assert.ok(!hits.some((h) => h.text === 'project two contract'));
    r.close();
  });

  await t.test('stats count in scope, so an empty scope short-circuits retrieval', () => {
    const r = scoped();
    assert.strictEqual(r.stats().count, 3);
    assert.strictEqual(r.stats({ projectId: 1 }).count, 2, 'own project plus global');
    assert.strictEqual(r.stats({ projectId: 99 }).count, 1, 'a project with only the global doc');
    r.close();
  });

  await t.test('listDocuments stays unscoped — the library view shows everything', () => {
    const r = scoped();
    assert.strictEqual(r.listDocuments().length, 3);
    r.close();
  });
});

test('only ready documents are searchable', () => {
  const r = repo();
  r.insertDocument(doc({ docId: 'pending', contentHash: 'h-p' }));
  r.insertChunks('pending', [chunk(0, unit([1, 0, 0, 0]), 'half indexed')]);
  // Deliberately not markReady: a partially indexed document must not answer
  // from an incomplete corpus without saying so.
  assert.deepStrictEqual(r.searchByVector(unit([1, 0, 0, 0])), []);

  r.markReady('pending', { chunkCount: 1, pageCount: 1 });
  assert.strictEqual(r.searchByVector(unit([1, 0, 0, 0])).length, 1);
  r.close();
});

test('deleting a document cascades to its chunks', () => {
  const r = repo();
  r.insertDocument(doc({ docId: 'd1', contentHash: 'h1' }));
  r.insertChunks('d1', [chunk(0, unit([1, 0, 0, 0])), chunk(1, unit([0, 1, 0, 0]))]);
  r.markReady('d1', { chunkCount: 2, pageCount: 1 });

  assert.strictEqual(r.searchByVector(unit([1, 0, 0, 0]), { limit: 10 }).length, 2);
  assert.strictEqual(r.deleteDocument('d1'), true);
  assert.strictEqual(r.getDocument('d1'), null);

  // ON DELETE CASCADE only fires with foreign_keys=ON, which the constructor
  // sets; without it these rows would be orphaned and still searchable.
  const orphans = r.db.prepare('SELECT COUNT(*) AS n FROM document_chunks').get();
  assert.strictEqual(orphans.n, 0, 'chunks were orphaned');

  assert.strictEqual(r.deleteDocument('d1'), false, 'second delete reports nothing removed');
  r.close();
});

test('listDocuments is newest first', () => {
  const r = repo();
  r.insertDocument(doc({ docId: 'old', contentHash: 'h1', uploadedAt: '2026-01-01T00:00:00Z' }));
  r.insertDocument(doc({ docId: 'new', contentHash: 'h2', uploadedAt: '2026-09-01T00:00:00Z' }));
  assert.deepStrictEqual(r.listDocuments().map((d) => d.docId), ['new', 'old']);
  r.close();
});
