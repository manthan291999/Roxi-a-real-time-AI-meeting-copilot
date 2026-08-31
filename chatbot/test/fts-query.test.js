/**
 * Unit tests: ftsQuery — FTS5 expression building & sanitization.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const {
  sanitizeToken,
  buildMatchExpressions,
  keywordsFromQuestion,
} = require('../src/infrastructure/persistence/ftsQuery');

test('sanitizeToken strips FTS5 specials and operators', () => {
  assert.strictEqual(sanitizeToken('hello"world'), 'hello world');
  // Operators are removed, then whitespace collapses and trims -> ''.
  assert.strictEqual(sanitizeToken('AND OR NOT'), '');
  assert.strictEqual(sanitizeToken('payment^2 (v1)'), 'payment 2 v1');
});

test('buildMatchExpressions: single keyword -> single term', () => {
  const exprs = buildMatchExpressions(['kubernetes']);
  assert.deepStrictEqual(exprs, ['kubernetes']);
});

test('buildMatchExpressions: multiple keywords -> AND then OR', () => {
  const exprs = buildMatchExpressions(['payment', 'webhook']);
  assert.strictEqual(exprs[0], 'payment AND webhook');
  assert.strictEqual(exprs[1], 'payment OR webhook');
});

test('buildMatchExpressions: multi-word keyword becomes quoted phrase', () => {
  const exprs = buildMatchExpressions(['payment gateway', 'timeout']);
  assert.ok(exprs[0].includes('"payment gateway"'));
  assert.ok(exprs[0].includes('AND timeout'));
});

test('buildMatchExpressions: embedded quotes are stripped (safety)', () => {
  // Sanitization removes quote chars entirely so they can never break MATCH;
  // the remaining words become a quoted phrase.
  const exprs = buildMatchExpressions(['he said "hi" loudly']);
  assert.ok(exprs[0].includes('"he said hi loudly"'));
  assert.ok(!exprs[0].includes('""'));
});

test('buildMatchExpressions: empty/garbage input -> []', () => {
  assert.deepStrictEqual(buildMatchExpressions([]), []);
  assert.deepStrictEqual(buildMatchExpressions(['***', '""']), []);
  assert.deepStrictEqual(buildMatchExpressions(null), []);
});

test('keywordsFromQuestion drops stopwords and short tokens', () => {
  const kws = keywordsFromQuestion('What did we decide about the database schema?');
  assert.ok(kws.includes('decide'));
  assert.ok(kws.includes('database'));
  assert.ok(kws.includes('schema'));
  assert.ok(!kws.includes('the'));
  assert.ok(!kws.includes('what'));
});
