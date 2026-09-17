/**
 * Unit tests: guardrail/triage. Pure — no adapters, no I/O, no API calls.
 *
 * Scope: greeting / help / ack / empty, and the pending-clarification
 * stand-down for greeting and ack. `gibberish` is covered by its own test
 * file once phase 5 lands (test/gibberish.test.js) — asserting it here would
 * test a signature this phase deliberately does not implement yet.
 * pendingClarification.js's own contract (the two signals independently) is
 * covered in test/pending-clarification.test.js; the tests here only check
 * that triage() actually consults it for the right classes.
 */
const test = require('node:test');
const assert = require('node:assert');

const { triage } = require('../src/application/guardrail/triage');
const { MODES, ROUTES } = require('../src/application/graph/constants');

test('greeting: exact tokens are intercepted', () => {
  for (const q of ['hi', 'Hi', 'HELLO', 'hey there', 'namaste']) {
    const result = triage({ question: q, mode: MODES.RAG });
    assert.strictEqual(result.intercept, true, `expected "${q}" to be intercepted`);
    assert.strictEqual(result.kind, 'greeting');
    assert.ok(result.answer.length > 0);
  }
});

test('greeting: punctuation/casing/whitespace variants all match via normalize', () => {
  const result = triage({ question: '  HI!!!  ', mode: MODES.RAG });
  assert.strictEqual(result.intercept, true);
  assert.strictEqual(result.kind, 'greeting');
});

test('greeting: rag mode offers meeting follow-ups, direct mode offers none', () => {
  const rag = triage({ question: 'hi', mode: MODES.RAG });
  const direct = triage({ question: 'hi', mode: MODES.DIRECT });
  assert.ok(rag.followUps.length > 0, 'rag mode should suggest something to ask');
  assert.deepStrictEqual(direct.followUps, [], 'direct mode consults no corpus, so no meeting-shaped suggestions');
  assert.notStrictEqual(rag.answer, direct.answer, 'the two modes should not claim the same thing happened');
});

test('help: exact tokens are intercepted with a capability description', () => {
  for (const q of ['help', 'what can you do', 'How Does This Work?']) {
    const result = triage({ question: q, mode: MODES.RAG });
    assert.strictEqual(result.intercept, true, `expected "${q}" to be intercepted`);
    assert.strictEqual(result.kind, 'help');
  }
});

test('ack: exact affirmative/negative tokens are intercepted when nothing is pending', () => {
  for (const q of ['yes', 'Yes', 'THANKS', 'ok', 'no', 'nope', 'nahi']) {
    const result = triage({ question: q, mode: MODES.RAG });
    assert.strictEqual(result.intercept, true, `expected "${q}" to be intercepted`);
    assert.strictEqual(result.kind, 'ack');
    assert.deepStrictEqual(result.followUps, []);
  }
});

test('ack: never offers follow-ups, in any mode', () => {
  assert.deepStrictEqual(triage({ question: 'thanks', mode: MODES.RAG }).followUps, []);
  assert.deepStrictEqual(triage({ question: 'thanks', mode: MODES.DIRECT }).followUps, []);
});

test('THE TRAP — ack stands down when a clarification is pending (signal: state.route)', () => {
  const pendingState = { question: 'yes', mode: MODES.RAG, route: ROUTES.CLARIFY };
  const result = triage(pendingState);
  assert.strictEqual(result.intercept, false, '"yes" answering a real clarifying question must reach the graph');
  assert.strictEqual(result.reason, 'ack_stood_down_pending_clarification');
});

test('THE TRAP — ack stands down when a clarification is pending (signal: history ends in "?")', () => {
  const pendingState = {
    question: 'no',
    mode: MODES.RAG,
    history: [{ role: 'assistant', content: 'Do you want the cause or the fix?' }],
  };
  assert.strictEqual(triage(pendingState).intercept, false);
});

test('greeting also stands down when a clarification is pending', () => {
  const pendingState = { question: 'hi', mode: MODES.RAG, route: ROUTES.CLARIFY };
  const result = triage(pendingState);
  assert.strictEqual(result.intercept, false);
  assert.strictEqual(result.reason, 'greeting_stood_down_pending_clarification');
});

test('help and empty do NOT stand down for a pending clarification — neither is a plausible clarify reply', () => {
  const pending = { mode: MODES.RAG, route: ROUTES.CLARIFY };
  assert.strictEqual(triage({ ...pending, question: 'help' }).intercept, true);
  assert.strictEqual(triage({ ...pending, question: 'help' }).kind, 'help');
  assert.strictEqual(triage({ ...pending, question: '' }).intercept, true);
  assert.strictEqual(triage({ ...pending, question: '' }).kind, 'empty');
});

test('without a pending clarification, ack and greeting behave exactly as before', () => {
  const noPending = { mode: MODES.RAG, route: ROUTES.GENERATE };
  assert.strictEqual(triage({ ...noPending, question: 'yes' }).intercept, true);
  assert.strictEqual(triage({ ...noPending, question: 'hi' }).intercept, true);
});

test('empty: blank, whitespace-only, punctuation-only, and emoji-only all intercept', () => {
  for (const q of ['', '   ', '...', '🎉🎉']) {
    const result = triage({ question: q, mode: MODES.RAG });
    assert.strictEqual(result.intercept, true, `expected ${JSON.stringify(q)} to be intercepted`);
    assert.strictEqual(result.kind, 'empty');
  }
});

test('THE WHOLE-MESSAGE RULE — real questions that start with a greeting token must reach the graph', () => {
  // These three are verbatim from this app's own chat logs (see
  // tokens.js's header comment and the pre-router plan §05). A prefix or
  // substring match on GREETING_TOKENS would incorrectly swallow all three.
  const realQuestions = [
    'hi what is the ML',
    'hi there can find the meeting about the ML',
    'hi what is the fundamentals of ML',
  ];
  for (const q of realQuestions) {
    const result = triage({ question: q, mode: MODES.RAG });
    assert.strictEqual(result.intercept, false, `"${q}" must not be intercepted`);
  }
});

test('THE WHOLE-MESSAGE RULE also holds for ack tokens — "yes" prefixing a real question is not an ack', () => {
  const realQuestions = [
    'yes and what did we decide about the database',
    'ok what risks did we discuss',
    'no I meant the other meeting',
  ];
  for (const q of realQuestions) {
    const result = triage({ question: q, mode: MODES.RAG });
    assert.strictEqual(result.intercept, false, `"${q}" must not be intercepted`);
  }
});

test('ordinary questions fall through untouched', () => {
  const realQuestions = [
    'What decisions have we made recently?',
    'What risks or issues did we discuss?',
    'ML',
    'krishaweb',
    'Nisha',
    'What does the term \'Tauri\' mean?',
  ];
  for (const q of realQuestions) {
    const result = triage({ question: q, mode: MODES.RAG });
    assert.strictEqual(result.intercept, false, `"${q}" must not be intercepted`);
    assert.strictEqual(result.answer, '');
    assert.deepStrictEqual(result.followUps, []);
  }
});

test('disabled: intercept is always false regardless of input', () => {
  for (const q of ['hi', 'help', '', '...']) {
    const result = triage({ question: q, mode: MODES.RAG }, { enabled: false });
    assert.strictEqual(result.intercept, false);
    assert.strictEqual(result.reason, 'guardrail_disabled');
  }
});

test('missing/non-string question degrades to the empty class rather than throwing', () => {
  assert.doesNotThrow(() => triage({}));
  assert.doesNotThrow(() => triage({ question: undefined }));
  assert.strictEqual(triage({}).kind, 'empty');
});

test('is pure — same input, same output, no matter how many times it runs', () => {
  const a = triage({ question: 'hi', mode: MODES.RAG });
  const b = triage({ question: 'hi', mode: MODES.RAG });
  assert.deepStrictEqual(a, b);
});

test('every result has the documented shape', () => {
  for (const q of ['hi', 'random real question about ML']) {
    const result = triage({ question: q, mode: MODES.RAG });
    assert.strictEqual(typeof result.intercept, 'boolean');
    assert.strictEqual(typeof result.answer, 'string');
    assert.ok(Array.isArray(result.followUps));
    assert.strictEqual(typeof result.reason, 'string');
  }
});
