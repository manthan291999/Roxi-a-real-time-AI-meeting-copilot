/**
 * Unit tests: guardrail/pendingClarification. Pure — no adapters, no I/O.
 *
 * Two independent signals (state.route, and the last history entry's
 * content) — see that file's own header comment, including the documented
 * gap: neither real caller in this codebase currently stores the clarifying
 * question as history content, so signal 2 is tested here against its own
 * specified contract, not against what either shipped caller happens to
 * send today (that gap is covered end to end by graph.test.js's two-turn
 * clarify -> "yes" test, which exercises signal 1, the one that actually
 * protects a live conversation).
 */
const test = require('node:test');
const assert = require('node:assert');

const { hasPendingClarification } = require('../src/application/guardrail/pendingClarification');
const { ROUTES } = require('../src/application/graph/constants');

test('signal 1: state.route === ROUTES.CLARIFY is pending, regardless of history', () => {
  assert.strictEqual(hasPendingClarification({ route: ROUTES.CLARIFY }), true);
  assert.strictEqual(hasPendingClarification({ route: ROUTES.CLARIFY, history: [] }), true);
});

test('signal 1: any other route value is not, on its own, pending', () => {
  for (const route of [ROUTES.GENERATE, ROUTES.NO_DATA, ROUTES.DIRECT, undefined, null, '']) {
    assert.strictEqual(hasPendingClarification({ route }), false, `route=${JSON.stringify(route)}`);
  }
});

test('signal 2: the last assistant turn ending in "?" is pending', () => {
  const state = {
    history: [
      { role: 'user', content: 'tell me about the webhook thing' },
      { role: 'assistant', content: 'Do you want the cause or the fix?' },
    ],
  };
  assert.strictEqual(hasPendingClarification(state), true);
});

test('signal 2: trailing whitespace after the "?" still counts', () => {
  const state = {
    history: [{ role: 'assistant', content: 'Do you want the cause or the fix?  \n' }],
  };
  assert.strictEqual(hasPendingClarification(state), true);
});

test('signal 2: an assistant turn NOT ending in "?" is not pending', () => {
  const state = {
    history: [{ role: 'assistant', content: 'I found related discussion in 2 meetings.' }],
  };
  assert.strictEqual(hasPendingClarification(state), false);
});

test('signal 2: only the LAST history entry counts, not an earlier one', () => {
  const state = {
    history: [
      { role: 'assistant', content: 'Do you want the cause or the fix?' },
      { role: 'user', content: 'the fix' },
      { role: 'assistant', content: 'We planned exponential backoff.' },
    ],
  };
  assert.strictEqual(hasPendingClarification(state), false);
});

test('signal 2: a USER turn ending in "?" does not count — only assistant turns ask', () => {
  const state = {
    history: [{ role: 'user', content: 'what did we decide?' }],
  };
  assert.strictEqual(hasPendingClarification(state), false);
});

test('either signal alone is sufficient', () => {
  // route says yes, history says no.
  assert.strictEqual(
    hasPendingClarification({
      route: ROUTES.CLARIFY,
      history: [{ role: 'assistant', content: 'Answered.' }],
    }),
    true,
  );
  // history says yes, route says no.
  assert.strictEqual(
    hasPendingClarification({
      route: ROUTES.GENERATE,
      history: [{ role: 'assistant', content: 'Do you mean X or Y?' }],
    }),
    true,
  );
});

test('malformed or missing state degrades to false rather than throwing', () => {
  assert.doesNotThrow(() => hasPendingClarification({}));
  assert.doesNotThrow(() => hasPendingClarification(undefined));
  assert.strictEqual(hasPendingClarification({}), false);
  assert.strictEqual(hasPendingClarification(undefined), false);
  assert.strictEqual(hasPendingClarification({ history: null }), false);
  assert.strictEqual(hasPendingClarification({ history: 'not an array' }), false);
  assert.strictEqual(hasPendingClarification({ history: [null, undefined] }), false);
  assert.strictEqual(hasPendingClarification({ history: [{ role: 'assistant', content: null }] }), false);
  assert.strictEqual(hasPendingClarification({ history: [{ role: 'assistant' }] }), false);
});

test('is pure', () => {
  const state = { route: ROUTES.CLARIFY };
  assert.strictEqual(hasPendingClarification(state), hasPendingClarification(state));
});
