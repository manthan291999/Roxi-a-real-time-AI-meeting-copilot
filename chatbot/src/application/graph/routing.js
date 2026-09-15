/**
 * routing — PURE decision logic for the graph's conditional edge.
 * Isolated from LangGraph so it can be unit-tested with plain objects.
 *
 * Decision table (evaluated after grade_documents):
 *   no evidence + attempts left  -> rewrite  (Corrective-RAG loop)
 *   no evidence + attempts spent -> no_data      | generate_web if web enabled
 *   evidence + ambiguous question-> clarify  (ask what exactly)
 *   evidence + clear question    -> generate     | generate_web if web enabled
 *
 * Web awareness is folded in here rather than added as a third decision
 * function because it changes only WHICH terminal a turn reaches, never
 * whether retrieval runs. With webMode absent (or unrecognised) every branch
 * returns exactly what it returned before this feature existed — which is
 * what lets routing.test.js keep every one of its original assertions.
 */

const { MAX_RETRIEVAL_ATTEMPTS, ROUTES, MODES } = require('./constants');
const { decideWebTools } = require('./webPolicy');

/**
 * Entry decision for the graph's START edge: does this question go through
 * retrieval at all?
 *
 * The "Knowledge" switch is a UI affordance; the rule lives here, beside
 * decideRoute, so it is testable with a plain object and LangGraph never owns
 * behaviour. Anything other than an explicit 'direct' means search — a typo
 * or a stale client must never silently disable the evidence path.
 *
 * @param {{mode?: string}} state
 * @returns {string} one of MODES
 */
function decideEntry(state) {
  if (state.mode !== MODES.DIRECT) return MODES.RAG;
  // Knowledge is off. Whether the web is on decides WHICH model-only leaf
  // this turn lands on; neither consults a corpus.
  return decideWebTools(state.webMode).enabled ? MODES.WEB_DIRECT : MODES.DIRECT;
}

/**
 * @param {{evidence?: Array, attempt?: number, isAmbiguous?: boolean, webMode?: string}} state
 * @returns {string} one of ROUTES
 */
function decideRoute(state) {
  const web = decideWebTools(state.webMode);
  const hasEvidence = Array.isArray(state.evidence) && state.evidence.length > 0;
  const attempt = state.attempt || 0;

  if (!hasEvidence) {
    if (attempt < MAX_RETRIEVAL_ATTEMPTS) return ROUTES.REWRITE;
    // Retrieval is spent. With the web available that is a last resort, not
    // a dead end: generate_web takes empty evidence and says so, which turns
    // "nothing in your meetings" into "nothing in your meetings, but here is
    // what the web says".
    return web.enabled ? ROUTES.GENERATE_WEB : ROUTES.NO_DATA;
  }
  // Ambiguity beats the web: asking which thing they meant is cheaper and
  // more useful than searching for the wrong one.
  if (state.isAmbiguous) return ROUTES.CLARIFY;
  return web.enabled ? ROUTES.GENERATE_WEB : ROUTES.GENERATE;
}

module.exports = { decideRoute, decideEntry };
