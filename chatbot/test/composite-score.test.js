/**
 * Unit tests: compositeScore — pure, no DB, no network. Same style as
 * rrf.test.js.
 */
const test = require('node:test');
const assert = require('node:assert');

const { compositeScore } = require('../src/application/retrieval/compositeScore');

const NOW = Date.parse('2026-09-01T00:00:00.000Z');
const WEIGHTS = { wRelevance: 0.6, wImportance: 0.25, wRecency: 0.15, recencyHalflifeDays: 14 };

function hit({ similarity = 0.9, importance = 0.6, createdAt = '2026-09-01T00:00:00.000Z' } = {}) {
  return { similarity, payload: { importance, created_at: createdAt } };
}

test('compositeScore', async (t) => {
  await t.test('a low-significance chunk from today must not consistently outrank a high-significance chunk from last week at equal similarity', () => {
    const today = hit({ similarity: 0.8, importance: 0.3, createdAt: '2026-09-01T00:00:00.000Z' });
    const lastWeek = hit({ similarity: 0.8, importance: 1.0, createdAt: '2026-08-25T00:00:00.000Z' });

    const scoreToday = compositeScore(today, NOW, WEIGHTS);
    const scoreLastWeek = compositeScore(lastWeek, NOW, WEIGHTS);

    assert.ok(scoreLastWeek > scoreToday, 'importance should outweigh a 7-day-old recency gap');
  });

  await t.test('relevance still dominates: a much lower similarity is not rescued by importance+recency', () => {
    const barelyRelevant = hit({ similarity: 0.26, importance: 1.0, createdAt: '2026-09-01T00:00:00.000Z' });
    const highlyRelevant = hit({ similarity: 0.95, importance: 0.3, createdAt: '2026-07-01T00:00:00.000Z' });

    assert.ok(
      compositeScore(highlyRelevant, NOW, WEIGHTS) > compositeScore(barelyRelevant, NOW, WEIGHTS)
    );
  });

  await t.test('recency decays to roughly half at exactly one half-life', () => {
    const fresh = hit({ createdAt: new Date(NOW).toISOString() });
    const oneHalfLifeOld = hit({ createdAt: new Date(NOW - 14 * 86_400_000).toISOString() });

    const freshScore = compositeScore(fresh, NOW, WEIGHTS);
    const oldScore = compositeScore(oneHalfLifeOld, NOW, WEIGHTS);

    // Both share identical relevance+importance terms, so the entire gap is
    // the recency term: 0.15 * (1 - 0.5) = 0.075.
    assert.ok(Math.abs(freshScore - oldScore - 0.075) < 0.001);
  });

  await t.test('missing importance defaults to 0.6 (medium) rather than crashing', () => {
    const score = compositeScore({ similarity: 0.5, payload: { created_at: '2026-09-01T00:00:00.000Z' } }, NOW, WEIGHTS);
    assert.ok(Number.isFinite(score));
  });

  await t.test('a missing or malformed created_at contributes zero recency, not NaN', () => {
    const missing = compositeScore({ similarity: 0.5, payload: { importance: 0.6 } }, NOW, WEIGHTS);
    const malformed = compositeScore(
      { similarity: 0.5, payload: { importance: 0.6, created_at: 'not-a-date' } },
      NOW,
      WEIGHTS
    );
    assert.ok(Number.isFinite(missing));
    assert.ok(Number.isFinite(malformed));
    // No recency contribution: exactly the relevance+importance terms.
    assert.ok(Math.abs(missing - (0.6 * 0.5 + 0.25 * 0.6)) < 1e-9);
  });

  await t.test('a future-dated chunk (clock skew) is clamped, not given a recency boost above 1', () => {
    const future = hit({ createdAt: new Date(NOW + 86_400_000).toISOString() });
    const exactlyNow = hit({ createdAt: new Date(NOW).toISOString() });
    assert.strictEqual(compositeScore(future, NOW, WEIGHTS), compositeScore(exactlyNow, NOW, WEIGHTS));
  });
});
