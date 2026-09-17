/**
 * Unit tests: routing — pure conditional-edge decision logic.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { decideRoute, decideEntry, decideEntryByMode } = require('../src/application/graph/routing');
const { ROUTES, MODES, MAX_RETRIEVAL_ATTEMPTS, WEB_MODES } = require('../src/application/graph/constants');

const EVIDENCE = [{ meetingId: 1, text: 'x' }];

// A real-shaped question, held constant across the mode/webMode-axis tests
// below — the same way EVIDENCE and attempt are held constant while varying
// webMode in the decideRoute tests further down. decideEntry now checks the
// guardrail (triage()) before it ever looks at mode/webMode, so every one of
// those tests needs a question that will not itself be intercepted, or it
// would stop testing the axis it says it tests. See "decideEntry: the
// guardrail axis" below for the guardrail's own tests.
const QUESTION = 'what did we discuss about the release';

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
// Every state below carries the constant QUESTION so these tests exercise
// only the mode axis, exactly as before — see the QUESTION comment above.

test('mode "direct" -> direct entry', () => {
  assert.strictEqual(decideEntry({ question: QUESTION, mode: MODES.DIRECT }), MODES.DIRECT);
});

test('mode "rag" -> retrieval entry', () => {
  assert.strictEqual(decideEntry({ question: QUESTION, mode: MODES.RAG }), MODES.RAG);
});

test('absent or unrecognised mode -> retrieval entry', () => {
  // Retrieval is the safe default: a typo or an older client must never
  // silently answer without evidence.
  assert.strictEqual(decideEntry({ question: QUESTION }), MODES.RAG);
  assert.strictEqual(decideEntry({ question: QUESTION, mode: undefined }), MODES.RAG);
  assert.strictEqual(decideEntry({ question: QUESTION, mode: null }), MODES.RAG);
  assert.strictEqual(decideEntry({ question: QUESTION, mode: 'DIRECT' }), MODES.RAG);
  assert.strictEqual(decideEntry({ question: QUESTION, mode: 'nonsense' }), MODES.RAG);
});


// --- decideEntry: the Web switch, orthogonal to Knowledge ---------------

test('decideEntry: the Web switch only matters when Knowledge is off', () => {
  // Knowledge on: the web changes which TERMINAL is reached (decideRoute's
  // job), never whether retrieval runs.
  assert.strictEqual(decideEntry({ question: QUESTION, mode: MODES.RAG, webMode: WEB_MODES.AUTO }), MODES.RAG);
  assert.strictEqual(decideEntry({ question: QUESTION, mode: MODES.RAG, webMode: WEB_MODES.ALWAYS }), MODES.RAG);
});

test('decideEntry: Knowledge off + Web on -> web_direct', () => {
  assert.strictEqual(
    decideEntry({ question: QUESTION, mode: MODES.DIRECT, webMode: WEB_MODES.AUTO }),
    MODES.WEB_DIRECT,
  );
  assert.strictEqual(
    decideEntry({ question: QUESTION, mode: MODES.DIRECT, webMode: WEB_MODES.ALWAYS }),
    MODES.WEB_DIRECT,
  );
});

test('decideEntry: Knowledge off + Web off -> the classic direct leaf', () => {
  assert.strictEqual(
    decideEntry({ question: QUESTION, mode: MODES.DIRECT, webMode: WEB_MODES.NEVER }),
    MODES.DIRECT,
  );
  // An absent or unrecognised webMode is OFF — this is the property that
  // keeps every assertion above this comment identical to before the
  // feature landed.
  assert.strictEqual(decideEntry({ question: QUESTION, mode: MODES.DIRECT }), MODES.DIRECT);
  assert.strictEqual(decideEntry({ question: QUESTION, mode: MODES.DIRECT, webMode: 'AUTO' }), MODES.DIRECT);
  assert.strictEqual(decideEntry({ question: QUESTION, mode: MODES.DIRECT, webMode: 'nonsense' }), MODES.DIRECT);
});

// --- decideEntry: the guardrail axis, checked before mode/webMode -------

test('a greeting -> small_talk, regardless of mode', () => {
  assert.strictEqual(decideEntry({ question: 'hi' }), MODES.SMALL_TALK);
  assert.strictEqual(decideEntry({ question: 'hi', mode: MODES.RAG }), MODES.SMALL_TALK);
  // The guardrail beats the Knowledge switch: a caller in 'direct' mode
  // still gets the instant reply, not a wasted direct_answer LLM call.
  assert.strictEqual(decideEntry({ question: 'hi', mode: MODES.DIRECT }), MODES.SMALL_TALK);
  assert.strictEqual(
    decideEntry({ question: 'hi', mode: MODES.DIRECT, webMode: WEB_MODES.ALWAYS }),
    MODES.SMALL_TALK,
  );
});

test('THE WHOLE-MESSAGE RULE holds at the routing layer too', () => {
  // A real question from this app's own logs that starts with a greeting
  // token must still reach retrieval — see tokens.js's own header comment.
  assert.strictEqual(decideEntry({ question: 'hi what is the ML', mode: MODES.RAG }), MODES.RAG);
});

test('a blank or entirely absent question collapses to the guardrail\'s empty class', () => {
  // AnswerQuestionUseCase rejects a blank question with INVALID_INPUT before
  // the graph ever runs (see that use case's own validation), so this state
  // shape does not occur in production — but decideEntry is a pure function
  // and must have a well-defined answer for it regardless of caller.
  assert.strictEqual(decideEntry({ question: '' }), MODES.SMALL_TALK);
  assert.strictEqual(decideEntry({}), MODES.SMALL_TALK);
});

test('decideEntryByMode has no guardrail check — it is the mode/webMode axis alone', () => {
  // This is exactly the function buildChatGraph falls back to when the
  // guardrail is not wired (CHATBOT_GUARDRAIL=off), so it must never itself
  // return MODES.SMALL_TALK, no matter what the question looks like.
  assert.strictEqual(decideEntryByMode({ question: 'hi' }), MODES.RAG);
  assert.strictEqual(decideEntryByMode({ question: 'hi', mode: MODES.DIRECT }), MODES.DIRECT);
  assert.strictEqual(
    decideEntryByMode({ question: 'hi', mode: MODES.DIRECT, webMode: WEB_MODES.AUTO }),
    MODES.WEB_DIRECT,
  );
  assert.strictEqual(decideEntryByMode({}), MODES.RAG);
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
