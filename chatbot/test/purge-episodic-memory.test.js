/**
 * Unit tests: PurgeEpisodicMemoryUseCase — 90-day episodic retention (plan
 * §01/§05a). VectorIndex is a fake, so no network call happens, same
 * convention as sync-episodic-memory.test.js.
 */
const test = require('node:test');
const assert = require('node:assert');

const { PurgeEpisodicMemoryUseCase } = require('../src/application/useCases/PurgeEpisodicMemoryUseCase');

function fakeVectorIndex(deleted = 0) {
  const calls = [];
  return {
    calls,
    deleteWhere: async (filter) => { calls.push(filter); return { deleted }; },
  };
}

test('PurgeEpisodicMemoryUseCase', async (t) => {
  await t.test('deletes points older than retentionDays via a created_at range filter', async () => {
    const vectorIndex = fakeVectorIndex(7);
    const useCase = new PurgeEpisodicMemoryUseCase({ vectorIndex, retentionDays: 90 });

    const before = Date.now();
    const result = await useCase.execute();
    assert.deepStrictEqual(result, { deleted: 7 });

    assert.strictEqual(vectorIndex.calls.length, 1);
    const [filter] = vectorIndex.calls;
    assert.deepStrictEqual(Object.keys(filter), ['must']);
    const [clause] = filter.must;
    assert.strictEqual(clause.key, 'created_at');
    assert.ok(clause.range && typeof clause.range.lt === 'string');

    // The cutoff is "now - 90 days", within a generous tolerance for test runtime.
    const cutoffMs = Date.parse(clause.range.lt);
    const expectedMs = before - 90 * 86_400_000;
    assert.ok(Math.abs(cutoffMs - expectedMs) < 5000, 'cutoff should be ~90 days before now');
  });

  await t.test('defaults retentionDays to 90 when not provided', async () => {
    const vectorIndex = fakeVectorIndex(0);
    const useCase = new PurgeEpisodicMemoryUseCase({ vectorIndex });
    await useCase.execute();

    const [filter] = vectorIndex.calls;
    const cutoffMs = Date.parse(filter.must[0].range.lt);
    const expectedMs = Date.now() - 90 * 86_400_000;
    assert.ok(Math.abs(cutoffMs - expectedMs) < 5000);
  });

  await t.test('returns { deleted: 0 } cleanly when nothing is past retention', async () => {
    const vectorIndex = fakeVectorIndex(0);
    const useCase = new PurgeEpisodicMemoryUseCase({ vectorIndex, retentionDays: 90 });
    assert.deepStrictEqual(await useCase.execute(), { deleted: 0 });
  });
});
