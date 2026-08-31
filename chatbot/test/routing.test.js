/**
 * Unit tests: routing — pure conditional-edge decision logic.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { decideRoute } = require('../src/application/graph/routing');
const { ROUTES, MAX_RETRIEVAL_ATTEMPTS } = require('../src/application/graph/constants');

const EVIDENCE = [{ meetingId: 1, text: 'x' }];

test('no evidence + attempts left -> rewrite', () => {
  assert.strictEqual(decideRoute({ evidence: [], attempt: 0 }), ROUTES.REWRITE);
  assert.strictEqual(decideRoute({ evidence: [], attempt: MAX_RETRIEVAL_ATTEMPTS - 1 }), ROUTES.REWRITE);
});

test('no evidence + attempts spent -> no_data', () => {
  assert.strictEqual(decideRoute({ evidence: [], attempt: MAX_RETRIEVAL_ATTEMPTS }), ROUTES.NO_DATA);
  assert.strictEqual(decideRoute({ evidence: [], attempt: MAX_RETRIEVAL_ATTEMPTS + 3 }), ROUTES.NO_DATA);
});

test('evidence + ambiguous -> clarify', () => {
  assert.strictEqual(decideRoute({ evidence: EVIDENCE, attempt: 0, isAmbiguous: true }), ROUTES.CLARIFY);
});

test('evidence + clear question -> generate', () => {
  assert.strictEqual(decideRoute({ evidence: EVIDENCE, attempt: 0, isAmbiguous: false }), ROUTES.GENERATE);
});

test('missing fields are treated as empty/false', () => {
  assert.strictEqual(decideRoute({}), ROUTES.REWRITE);
  assert.strictEqual(decideRoute({ evidence: null }), ROUTES.REWRITE);
});
