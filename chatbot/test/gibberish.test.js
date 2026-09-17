/**
 * Unit tests: guardrail/gibberish. Pure — no adapters, no I/O, no database.
 * `probe` is always a plain `{has}` double here — see CorpusProbe.js's own
 * contract; test/corpus-probe.test.js covers the real FTS-backed adapter.
 */
const test = require('node:test');
const assert = require('node:assert');

const { isGibberishMessage, isGibberishToken } = require('../src/application/guardrail/gibberish');

/** A probe that never finds anything — the worst case for every gate below. */
const neverFinds = { has: () => false };
/** A probe that always finds the term — the corpus veto in action. */
const alwaysFinds = { has: () => true };

test('THE MOTIVATING EXAMPLE — pure noise is caught', () => {
  assert.strictEqual(isGibberishMessage('hbvxvsjhvbcjhvjbcx jbh cbh', neverFinds), true);
});

test('a single very long consonant-run token is gibberish on its own', () => {
  assert.strictEqual(isGibberishToken('hbvxvsjhvbcjhvjbcx', neverFinds), true);
});

test('a token with almost no distinct characters is gibberish', () => {
  assert.strictEqual(isGibberishToken('aaaaaaaaaa', neverFinds), true);
  assert.strictEqual(isGibberishMessage('aaaaaaaaaa', neverFinds), true);
});

test('LENGTH GATE — real short acronyms are exempt, even with a hostile probe', () => {
  // These are all verbatim from this app's own chat logs or its own
  // codebase vocabulary (tokens.js / the pre-router plan §06).
  for (const w of ['ML', 'RRF', 'FTS5']) {
    assert.strictEqual(isGibberishToken(w.toLowerCase(), neverFinds), false, w);
    assert.strictEqual(isGibberishMessage(w, neverFinds), false, w);
  }
});

test('SHAPE GATE — real words with decent vowel ratio, diversity and no long consonant run pass', () => {
  for (const w of ['Nisha', 'krishaweb', 'Tauri', 'webhook', 'Kubernetes', 'snake_case_identifier']) {
    assert.strictEqual(isGibberishMessage(w, neverFinds), false, w);
  }
});

test('CORPUS GATE — a shape-suspicious token found in the corpus is rescued', () => {
  // Same token, opposite verdicts depending only on what the probe reports.
  assert.strictEqual(isGibberishToken('hbvxvsjhvbcjhvjbcx', neverFinds), true);
  assert.strictEqual(isGibberishToken('hbvxvsjhvbcjhvjbcx', alwaysFinds), false);
});

test('an absent probe fails open exactly like a probe that always finds the term', () => {
  assert.strictEqual(isGibberishToken('hbvxvsjhvbcjhvjbcx', undefined), false);
  assert.strictEqual(isGibberishToken('hbvxvsjhvbcjhvjbcx', null), false);
  assert.strictEqual(isGibberishMessage('hbvxvsjhvbcjhvjbcx jbh cbh', undefined), false);
});

test('a probe that VIOLATES the CorpusProbe contract by throwing is NOT caught here', () => {
  // gibberish.js trusts the CorpusProbe contract completely (see
  // CorpusProbe.js: has() must resolve every failure to true, never throw)
  // and does not defensively wrap has() itself. Failing open on a read
  // error is the ADAPTER's job — see FtsCorpusProbe, and
  // test/corpus-probe.test.js's own "fails open" tests — not a second
  // safety net duplicated here. A probe double that breaks the contract
  // (as this one deliberately does) propagates, on purpose: masking it here
  // would hide a real adapter bug instead of surfacing it.
  const contractBreakingProbe = { has: () => { throw new Error('index locked'); } };
  assert.throws(() => isGibberishToken('hbvxvsjhvbcjhvjbcx', contractBreakingProbe));
});

test('MESSAGE-LEVEL, PART 1 — any token that looks like ordinary language stops the whole message, even a short one', () => {
  // "what/did/we/say/about" are all ≤5 chars (length-exempt), but their
  // SHAPE alone (ordinary vowel ratios) is enough to call the sentence
  // real without ever reaching the one strange token — the scenario that
  // most needed this rule: a real question quoting a strange term.
  assert.strictEqual(isGibberishMessage('what did we say about hbvxvsjhvbcjhvjbcx', neverFinds), false);
  assert.strictEqual(isGibberishMessage('hi what is the ML', neverFinds), false);
});

test('MESSAGE-LEVEL, PART 2 — nothing but short, odd-shaped tokens stays undecided', () => {
  // Neither token is long enough to formally convict, and their shape
  // alone does not save them either (both have zero vowels) — this is the
  // conservative side of the same asymmetry: favour the false negative.
  assert.strictEqual(isGibberishMessage('jbh cbh', neverFinds), false);
});

test('a real question with a genuinely odd term embedded still falls through', () => {
  const realQuestions = [
    'what did we say about hbvxvsjhvbcjhvjbcx',
    'can you find the meeting about krishaweb',
    'does the term qwzxjklm mean anything to you',
  ];
  for (const q of realQuestions) {
    assert.strictEqual(isGibberishMessage(q, neverFinds), false, q);
  }
});

test('ordinary real questions from this app\'s own logs are never gibberish', () => {
  const realQuestions = [
    'What decisions have we made recently?',
    'What risks or issues did we discuss?',
    'What does the term \'Tauri\' mean?',
    'have we talk about the ML ?',
    'can you find the ML meeting',
  ];
  for (const q of realQuestions) {
    assert.strictEqual(isGibberishMessage(q, neverFinds), false, q);
  }
});

test('MESSAGE LENGTH CAP — a long message is never classified as gibberish regardless of content', () => {
  const longNoise = Array.from({ length: 10 }, () => 'hbvxvsjhvbcjhvjbcx').join(' ');
  assert.strictEqual(isGibberishMessage(longNoise, neverFinds), false);
});

test('empty and whitespace/punctuation-only input is not gibberish — that is the \'empty\' class\'s job', () => {
  assert.strictEqual(isGibberishMessage('', neverFinds), false);
  assert.strictEqual(isGibberishMessage('   ', neverFinds), false);
  assert.strictEqual(isGibberishMessage('...', neverFinds), false);
});

test('internal punctuation is stripped per-token, not just at the message edges', () => {
  // Distinguishes gibberish.js's own tokenizer from normalize.js, which
  // only trims the whole message's edges (see this file's header comment).
  assert.strictEqual(
    isGibberishMessage('hbvxvsjhvbcjhvjbcx, jbh, cbh!', neverFinds),
    true,
  );
});

test('is pure', () => {
  const a = isGibberishMessage('hbvxvsjhvbcjhvjbcx jbh cbh', neverFinds);
  const b = isGibberishMessage('hbvxvsjhvbcjhvjbcx jbh cbh', neverFinds);
  assert.strictEqual(a, b);
});
