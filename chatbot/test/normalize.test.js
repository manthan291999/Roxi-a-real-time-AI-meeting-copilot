/**
 * Unit tests: guardrail/normalize. Pure — no adapters, no I/O.
 */
const test = require('node:test');
const assert = require('node:assert');

const { normalize } = require('../src/application/guardrail/normalize');

test('casing', () => {
  assert.strictEqual(normalize('HI'), 'hi');
  assert.strictEqual(normalize('Hello'), 'hello');
  assert.strictEqual(normalize('WhAt CaN yOu Do'), 'what can you do');
});

test('leading/trailing punctuation is trimmed, internal punctuation is not', () => {
  assert.strictEqual(normalize('hi!!!'), 'hi');
  assert.strictEqual(normalize('hi...'), 'hi');
  assert.strictEqual(normalize('~hi~'), 'hi');
  assert.strictEqual(normalize('Hi.'), 'hi');
  assert.strictEqual(normalize('!?hi?!'), 'hi');
  // internal punctuation (mid-string) must survive — it changes meaning.
  assert.strictEqual(normalize('what is speaker a, b, and c?'), 'what is speaker a, b, and c');
});

test('whitespace is collapsed and trimmed', () => {
  assert.strictEqual(normalize('  hi   there  '), 'hi there');
  assert.strictEqual(normalize('hi\n\tthere'), 'hi there');
  assert.strictEqual(normalize('   '), '');
});

test('the exact "  HI!!!  " / "Hi." / "hi" case from the spec collapse to one key', () => {
  const key = normalize('hi');
  assert.strictEqual(normalize('  HI!!!  '), key);
  assert.strictEqual(normalize('Hi.'), key);
});

test('emoji are stripped', () => {
  assert.strictEqual(normalize('hi 👋'), 'hi');
  assert.strictEqual(normalize('👋 hi 🎉'), 'hi');
  assert.strictEqual(normalize('🎉🎉🎉'), '');
});

test('zero-width and BOM characters are stripped', () => {
  assert.strictEqual(normalize('h​i'), 'hi');
  assert.strictEqual(normalize('﻿hi'), 'hi');
  assert.strictEqual(normalize('hi‍'), 'hi');
});

test('NFKC folds compatibility forms', () => {
  // Fullwidth "ｈｉ" (U+FF48 U+FF49) folds to ASCII "hi" under NFKC.
  assert.strictEqual(normalize('ｈｉ'), 'hi');
});

test('non-string and empty input degrade to the empty key, not a throw', () => {
  assert.strictEqual(normalize(''), '');
  assert.strictEqual(normalize(null), '');
  assert.strictEqual(normalize(undefined), '');
  assert.strictEqual(normalize(42), '');
  assert.strictEqual(normalize({}), '');
});

test('punctuation-only input normalizes to empty', () => {
  assert.strictEqual(normalize('...'), '');
  assert.strictEqual(normalize('!?!'), '');
  assert.strictEqual(normalize('---'), '');
});

test('is idempotent — normalizing an already-normalized key changes nothing', () => {
  const key = normalize('  Hi There!!!  ');
  assert.strictEqual(normalize(key), key);
});
