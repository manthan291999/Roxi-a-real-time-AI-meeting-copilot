const test = require('node:test');
const assert = require('node:assert');
const { TranscriptSanitizer } = require('../stt/transcript-sanitizer');

test('TranscriptSanitizer conformance tests', async (t) => {
  const sanitizer = new TranscriptSanitizer();

  await t.test('accepts valid transcript', () => {
    const result = sanitizer.sanitize('Hello world', 0.9);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.text, 'Hello world');
  });

  await t.test('rejects empty text', () => {
    const result = sanitizer.sanitize('   ', 0.9);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'empty_text');
  });

  await t.test('accepts single meaningful word', () => {
    const result = sanitizer.sanitize('Yes', 0.9);
    assert.strictEqual(result.ok, true);
  });

  await t.test('accepts single character word', () => {
    const result = sanitizer.sanitize('I', 0.9);
    assert.strictEqual(result.ok, true);
  });

  await t.test('rejects missing confidence', () => {
    const result = sanitizer.sanitize('Hello world', undefined);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'missing_confidence');
  });

  await t.test('rejects low confidence', () => {
    const result = sanitizer.sanitize('Hello world', 0.3);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'low_confidence');
  });

  await t.test('rejects blocklist phrases', () => {
    const result = sanitizer.sanitize('please subscribe right now', 0.9);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'blocklist_phrase');
  });

  await t.test('rejects repetitive words', () => {
    const result = sanitizer.sanitize('no no no', 0.9);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'repetitive_words');
  });
});
