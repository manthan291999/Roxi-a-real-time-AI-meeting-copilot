/**
 * Unit tests: json-parse — lenient JSON extraction from LLM output.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { parseJsonLoose } = require('../src/infrastructure/llm/json-parse');

test('parses plain JSON', () => {
  assert.deepStrictEqual(parseJsonLoose('{"a": 1}'), { a: 1 });
});

test('parses JSON wrapped in code fences', () => {
  const text = '```json\n{"answer": "hi"}\n```';
  assert.deepStrictEqual(parseJsonLoose(text), { answer: 'hi' });
});

test('extracts balanced object from surrounding prose', () => {
  const text = 'Sure! Here you go: {"x": {"y": [1,2]}} hope that helps';
  assert.deepStrictEqual(parseJsonLoose(text), { x: { y: [1, 2] } });
});

test('handles braces inside strings', () => {
  const text = 'noise {"msg": "use { and } carefully"} noise';
  assert.deepStrictEqual(parseJsonLoose(text), { msg: 'use { and } carefully' });
});

test('returns null for unrecoverable input', () => {
  assert.strictEqual(parseJsonLoose('no json here'), null);
  assert.strictEqual(parseJsonLoose(''), null);
  assert.strictEqual(parseJsonLoose(null), null);
  assert.strictEqual(parseJsonLoose('{broken'), null);
});
