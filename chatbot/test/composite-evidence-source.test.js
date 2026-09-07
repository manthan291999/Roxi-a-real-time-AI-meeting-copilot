/**
 * Unit tests: CompositeEvidenceSource — fan-out, degradation, and the
 * substitutability that lets retrieveNode stay unaware of how many corpora
 * exist. Fake sources only; no I/O.
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  CompositeEvidenceSource,
} = require('../src/application/retrieval/CompositeEvidenceSource');

const hit = (sourceType, sourceId) => ({
  sourceType,
  sourceTable: sourceType === 'document' ? 'documents' : 'transcripts',
  sourceId,
  groupKey: sourceType === 'document' ? 'doc:a' : 'meeting:1',
  text: `${sourceType}-${sourceId}`,
  score: 1,
});

/** A source that records the query it was given. */
function fakeSource(name, hits, { fail = false, delayMs = 0 } = {}) {
  const seen = [];
  return {
    name,
    seen,
    search: async (query) => {
      seen.push(query);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (fail) throw new Error(`${name} is down`);
      return hits;
    },
  };
}

test('degenerate configurations', async (t) => {
  await t.test('no sources -> no hits', async () => {
    const composite = new CompositeEvidenceSource({ sources: [] });
    assert.deepStrictEqual(await composite.search({ question: 'q', limit: 5 }), []);
  });

  await t.test('null entries are filtered out at construction', async () => {
    const composite = new CompositeEvidenceSource({
      sources: [null, fakeSource('a', [hit('meeting', 1)]), undefined],
    });
    assert.strictEqual((await composite.search({ question: 'q', limit: 5 })).length, 1);
  });
});

test('is itself an EvidenceSource', async () => {
  // Liskov: retrieveNode cannot tell a composite from a single source, which
  // is what lets a fourth corpus be added without touching the node.
  const composite = new CompositeEvidenceSource({ sources: [fakeSource('a', [])] });
  assert.strictEqual(typeof composite.name, 'string');
  assert.strictEqual(typeof composite.search, 'function');
  assert.ok((await composite.search({ question: 'q', limit: 1 })) instanceof Array);
});

test('passes the whole query to every source', async () => {
  const lexical = fakeSource('meetings', []);
  const semantic = fakeSource('documents', []);
  const composite = new CompositeEvidenceSource({ sources: [lexical, semantic] });

  const query = { question: 'what did we decide?', matchExprs: ['decide'], limit: 7 };
  await composite.search(query);

  // Each source needs a different form of the query, so both must arrive
  // everywhere and the adapter decides what it can use.
  for (const source of [lexical, semantic]) {
    assert.strictEqual(source.seen.length, 1);
    assert.deepStrictEqual(source.seen[0], query);
  }
});

test('merges results from every source', async () => {
  const composite = new CompositeEvidenceSource({
    sources: [
      fakeSource('meetings', [hit('meeting', 1), hit('meeting', 2)]),
      fakeSource('documents', [hit('document', 'c1')]),
    ],
  });

  const merged = await composite.search({ question: 'q', limit: 10 });
  assert.strictEqual(merged.length, 3);
  assert.ok(merged.some((h) => h.sourceType === 'meeting'));
  assert.ok(merged.some((h) => h.sourceType === 'document'));
  // Rank fusion attaches a merged score.
  assert.ok(merged.every((h) => typeof h.rrfScore === 'number'));
});

test('one failing source degrades instead of failing the question', async (t) => {
  await t.test('the healthy corpus still answers', async () => {
    const warnings = [];
    const composite = new CompositeEvidenceSource({
      sources: [
        fakeSource('meetings', [hit('meeting', 1)]),
        fakeSource('documents', [], { fail: true }),
      ],
      logger: { warn: (c, e, d) => warnings.push(d), info: () => {}, debug: () => {} },
    });

    const merged = await composite.search({ question: 'q', limit: 10 });
    assert.strictEqual(merged.length, 1, 'the meeting hit survives');
    assert.strictEqual(merged[0].sourceType, 'meeting');
    assert.strictEqual(warnings.length, 1, 'and the failure is logged, not swallowed silently');
    assert.match(warnings[0].message, /documents is down/);
  });

  await t.test('every source failing yields no hits rather than throwing', async () => {
    const composite = new CompositeEvidenceSource({
      sources: [
        fakeSource('meetings', [], { fail: true }),
        fakeSource('documents', [], { fail: true }),
      ],
      logger: { warn: () => {}, info: () => {}, debug: () => {} },
    });
    // routing can then decide rewrite/no_data, which is the designed path.
    assert.deepStrictEqual(await composite.search({ question: 'q', limit: 5 }), []);
  });

  await t.test('a source returning a non-array is treated as empty', async () => {
    const broken = { name: 'weird', search: async () => 'not an array' };
    const composite = new CompositeEvidenceSource({
      sources: [broken, fakeSource('meetings', [hit('meeting', 1)])],
    });
    assert.strictEqual((await composite.search({ question: 'q', limit: 5 })).length, 1);
  });
});

test('sources run concurrently, not in sequence', async () => {
  // The document source makes a network round trip; running it after the
  // local SQLite read would add its latency to every question.
  const composite = new CompositeEvidenceSource({
    sources: [
      fakeSource('a', [hit('meeting', 1)], { delayMs: 60 }),
      fakeSource('b', [hit('document', 'c1')], { delayMs: 60 }),
    ],
  });

  const started = Date.now();
  await composite.search({ question: 'q', limit: 5 });
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 110, `expected concurrent (~60ms), took ${elapsed}ms`);
});

test('the limit applies to the merged result', async () => {
  const composite = new CompositeEvidenceSource({
    sources: [
      fakeSource('a', [hit('meeting', 1), hit('meeting', 2), hit('meeting', 3)]),
      fakeSource('b', [hit('document', 'c1'), hit('document', 'c2')]),
    ],
  });
  assert.strictEqual((await composite.search({ question: 'q', limit: 2 })).length, 2);
});
