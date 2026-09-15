/**
 * Unit tests: routing — pure conditional-edge decision logic.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { decideRoute, decideEntry } = require('../src/application/graph/routing');
const { ROUTES, MODES, MAX_RETRIEVAL_ATTEMPTS, WEB_MODES } = require('../src/application/graph/constants');

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

// --- decideEntry: the Knowledge switch ---------------------------------

test('mode "direct" -> direct entry', () => {
  assert.strictEqual(decideEntry({ mode: MODES.DIRECT }), MODES.DIRECT);
});

test('mode "rag" -> retrieval entry', () => {
  assert.strictEqual(decideEntry({ mode: MODES.RAG }), MODES.RAG);
});

test('absent or unrecognised mode -> retrieval entry', () => {
  // Retrieval is the safe default: a typo or an older client must never
  // silently answer without evidence.
  assert.strictEqual(decideEntry({}), MODES.RAG);
  assert.strictEqual(decideEntry({ mode: undefined }), MODES.RAG);
  assert.strictEqual(decideEntry({ mode: null }), MODES.RAG);
  assert.strictEqual(decideEntry({ mode: 'DIRECT' }), MODES.RAG);
  assert.strictEqual(decideEntry({ mode: 'nonsense' }), MODES.RAG);
});


// --- decideEntry: the Web switch, orthogonal to Knowledge ---------------

test('decideEntry: the Web switch only matters when Knowledge is off', () => {
  // Knowledge on: the web changes which TERMINAL is reached (decideRoute's
  // job), never whether retrieval runs.
  assert.strictEqual(decideEntry({ mode: MODES.RAG, webMode: WEB_MODES.AUTO }), MODES.RAG);
  assert.strictEqual(decideEntry({ mode: MODES.RAG, webMode: WEB_MODES.ALWAYS }), MODES.RAG);
});

test('decideEntry: Knowledge off + Web on -> web_direct', () => {
  assert.strictEqual(decideEntry({ mode: MODES.DIRECT, webMode: WEB_MODES.AUTO }), MODES.WEB_DIRECT);
  assert.strictEqual(decideEntry({ mode: MODES.DIRECT, webMode: WEB_MODES.ALWAYS }), MODES.WEB_DIRECT);
});

test('decideEntry: Knowledge off + Web off -> the classic direct leaf', () => {
  assert.strictEqual(decideEntry({ mode: MODES.DIRECT, webMode: WEB_MODES.NEVER }), MODES.DIRECT);
  // An absent or unrecognised webMode is OFF — this is the property that
  // keeps every assertion above this comment identical to before the
  // feature landed.
  assert.strictEqual(decideEntry({ mode: MODES.DIRECT }), MODES.DIRECT);
  assert.strictEqual(decideEntry({ mode: MODES.DIRECT, webMode: 'AUTO' }), MODES.DIRECT);
  assert.strictEqual(decideEntry({ mode: MODES.DIRECT, webMode: 'nonsense' }), MODES.DIRECT);
});

// --- decideRoute with the web enabled ----------------------------------

test('evidence + web enabled -> generate_web', () => {
  assert.strictEqual(
    decideRoute({ evidence: EVIDENCE, attempt: 0, webMode: WEB_MODES.AUTO }),
    ROUTES.GENERATE_WEB,
  );
  assert.strictEqual(
    decideRoute({ evidence: EVIDENCE, attempt: 0, webMode: WEB_MODES.ALWAYS }),
    ROUTES.GENERATE_WEB,
  );
});

test('no evidence + attempts spent + web enabled -> generate_web, not no_data', () => {
  // The web is a last resort rather than a dead end: "nothing in your
  // meetings" becomes "nothing in your meetings, but here is what the web says".
  assert.strictEqual(
    decideRoute({ evidence: [], attempt: MAX_RETRIEVAL_ATTEMPTS, webMode: WEB_MODES.AUTO }),
    ROUTES.GENERATE_WEB,
  );
});

test('the rewrite loop still runs first, web or no web', () => {
  // Searching the web before the corrective loop has finished would pay for
  // an external call the user's own records may well have answered.
  assert.strictEqual(
    decideRoute({ evidence: [], attempt: 0, webMode: WEB_MODES.ALWAYS }),
    ROUTES.REWRITE,
  );
});

test('ambiguity beats the web', () => {
  // Asking which thing they meant is cheaper and more useful than searching
  // for the wrong one.
  assert.strictEqual(
    decideRoute({ evidence: EVIDENCE, attempt: 0, isAmbiguous: true, webMode: WEB_MODES.ALWAYS }),
    ROUTES.CLARIFY,
  );
});

test('an unrecognised webMode routes exactly as before the feature existed', () => {
  for (const bad of [undefined, null, '', 'AUTO', 'yes', 1]) {
    assert.strictEqual(decideRoute({ evidence: EVIDENCE, attempt: 0, webMode: bad }), ROUTES.GENERATE);
    assert.strictEqual(
      decideRoute({ evidence: [], attempt: MAX_RETRIEVAL_ATTEMPTS, webMode: bad }),
      ROUTES.NO_DATA,
    );
  }
});
