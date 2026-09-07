/**
 * Unit tests: Reciprocal Rank Fusion. Pure — no adapters, no I/O.
 */
const test = require('node:test');
const assert = require('node:assert');

const { fuse, defaultKey } = require('../src/application/retrieval/rrf');
const { RRF_K } = require('../src/application/graph/constants');

const meeting = (id, score = 1) => ({
  sourceType: 'meeting',
  sourceTable: 'transcripts',
  sourceId: id,
  groupKey: 'meeting:1',
  text: `m${id}`,
  score,
});

const document = (chunkId, score = 0.9) => ({
  sourceType: 'document',
  sourceTable: 'documents',
  sourceId: chunkId,
  groupKey: 'doc:a',
  text: `d${chunkId}`,
  score,
});

test('identity behaviour', async (t) => {
  await t.test('no lists -> nothing', () => {
    assert.deepStrictEqual(fuse([]), []);
    assert.deepStrictEqual(fuse([[], []]), []);
  });

  await t.test('non-array entries are ignored, not fatal', () => {
    assert.deepStrictEqual(fuse([null, undefined, [meeting(1)]]).length, 1);
  });

  await t.test('a single source preserves its order exactly', () => {
    const list = [meeting(1), meeting(2), meeting(3), meeting(4)];
    const fused = fuse([list]);
    assert.deepStrictEqual(fused.map((h) => h.sourceId), [1, 2, 3, 4]);
  });

  await t.test('the original hit fields survive the merge', () => {
    const [hit] = fuse([[document('c1')]]);
    assert.strictEqual(hit.sourceType, 'document');
    assert.strictEqual(hit.groupKey, 'doc:a');
    assert.strictEqual(hit.text, 'dc1');
    assert.ok(typeof hit.rrfScore === 'number');
  });
});

test('scale independence', () => {
  // The whole point: BM25-derived scores are unbounded and cosine is 0..1.
  // A source whose scores are numerically tiny must not be penalised.
  const lexical = [meeting(1, 900), meeting(2, 850)];
  const semantic = [document('c1', 0.31), document('c2', 0.30)];

  const fused = fuse([lexical, semantic]);
  // Rank 1 from each source ties, so both appear before either rank 2.
  assert.deepStrictEqual(
    fused.slice(0, 2).map((h) => h.sourceId).sort(),
    [1, 'c1'].sort(),
  );
});

test('agreement between sources outranks a single top hit', () => {
  const agreed = meeting(7);
  // `agreed` is rank 2 in one list and rank 2 in the other; `solo` is rank 1
  // in one list and absent from the other.
  const listA = [meeting(99), agreed];
  const listB = [document('x'), agreed];

  const fused = fuse([listA, listB]);
  assert.strictEqual(
    fused[0].sourceId,
    7,
    'a hit found by both sources should win over a single source\'s first place',
  );
  // Its score is the sum of both contributions.
  assert.ok(
    Math.abs(fused[0].rrfScore - (2 / (RRF_K + 2))) < 1e-12,
    `got ${fused[0].rrfScore}`,
  );
});

test('the same passage from two sources is merged, not duplicated', () => {
  const fused = fuse([[meeting(5)], [meeting(5)]]);
  assert.strictEqual(fused.length, 1, 'one entry, not two');
  assert.ok(Math.abs(fused[0].rrfScore - 2 / (RRF_K + 1)) < 1e-12);
});

test('ties are deterministic', () => {
  // Two hits at identical rank in separate lists have identical scores; the
  // order must still be stable across runs, or the UI reshuffles at random.
  const a = fuse([[meeting(2)], [meeting(1)]]).map((h) => h.sourceId);
  const b = fuse([[meeting(2)], [meeting(1)]]).map((h) => h.sourceId);
  const c = fuse([[meeting(1)], [meeting(2)]]).map((h) => h.sourceId);
  assert.deepStrictEqual(a, b, 'repeatable');
  assert.deepStrictEqual(a.sort(), c.sort(), 'same membership regardless of list order');
});

test('limit trims after merging, not before', () => {
  const lexical = [meeting(1), meeting(2), meeting(3)];
  const semantic = [document('c1'), document('c2')];
  const fused = fuse([lexical, semantic], { limit: 3 });
  assert.strictEqual(fused.length, 3);
  // Both corpora are represented in the top 3 rather than one crowding out
  // the other.
  assert.ok(fused.some((h) => h.sourceType === 'meeting'));
  assert.ok(fused.some((h) => h.sourceType === 'document'));
});

test('k flattens the rank curve', () => {
  const lists = [[meeting(1), meeting(2)]];
  const tight = fuse(lists, { k: 1 });
  const flat = fuse(lists, { k: 10000 });
  const gap = (f) => f[0].rrfScore - f[1].rrfScore;
  assert.ok(gap(tight) > gap(flat), 'a larger k brings adjacent ranks closer');
});

test('defaultKey separates the corpora', () => {
  assert.strictEqual(defaultKey(meeting(3)), 'meeting:transcripts:3');
  assert.strictEqual(defaultKey(document('c9')), 'doc:c9');
  // A meeting row and a document chunk that happen to share an id must not
  // collide.
  assert.notStrictEqual(defaultKey(meeting('c9')), defaultKey(document('c9')));
});
