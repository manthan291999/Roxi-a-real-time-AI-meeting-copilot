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
 *
 * decideEntry additionally consults the zero-LLM guardrail (triage(), see
 * application/guardrail/) BEFORE the mode/webMode axis below — a greeting or
 * a help request never reaches analyze_query, direct_answer or web_answer at
 * all. This costs a sub-millisecond Set lookup on every turn, small-talk or
 * not, in exchange for that turn never reaching the graph's own machinery.
 *
 * The mode/webMode axis is kept as its own function, decideEntryByMode,
 * rather than inlined into decideEntry, because it is also what a DISABLED
 * guardrail falls back to: decideEntry forwards its own `triageOpts` second
 * argument straight into triage(), so buildChatGraph can pass
 * `{ enabled: false }` when the guardrail is not wired — triage() then
 * always returns intercept:false regardless of content, and decideEntry
 * falls through to decideEntryByMode(state) on its own. That is what keeps
 * "capability not configured" behaving as a true no-op: a turn that would
 * have been intercepted lands on ANALYZE for a 'rag' state but DIRECT or
 * WEB_DIRECT for a 'direct' one, exactly as decideEntryByMode alone would
 * say, never one fixed node regardless of mode (which a static mapping-table
 * fallback cannot express, because the correct destination depends on
 * `state.mode`).
 *
 * decideEntry's second argument is also how a real CorpusProbe reaches the
 * gibberish gate on the ROUTING side, not just the rendering side: without
 * it, decideEntry's own triage() call would silently use no probe at all,
 * disagreeing with smallTalkNode's call (which does have one) — a gibberish
 * message would then never even be ROUTED to small_talk in the first place,
 * regardless of what the node would have decided if it ever ran. See
 * buildChatGraph.js's entryDecider, which passes both `corpusProbe` and
 * `enabled` through on every call.
 */

const { MAX_RETRIEVAL_ATTEMPTS, ROUTES, MODES } = require('./constants');
const { decideWebTools } = require('./webPolicy');
const { triage } = require('../guardrail/triage');

/**
 * The Knowledge/Web axis alone, with no guardrail check — decideEntry's
 * fallback branch, and also what buildChatGraph re-derives from when the
 * guardrail is not wired (see this file's header comment).
 *
 * @param {{mode?: string, webMode?: string}} state
 * @returns {string} one of MODES, never MODES.SMALL_TALK
 */
function decideEntryByMode(state) {
  if (state.mode !== MODES.DIRECT) return MODES.RAG;
  // Knowledge is off. Whether the web is on decides WHICH model-only leaf
  // this turn lands on; neither consults a corpus.
  return decideWebTools(state.webMode).enabled ? MODES.WEB_DIRECT : MODES.DIRECT;
}

/**
 * Entry decision for the graph's START edge: does this question go through
 * retrieval at all — or does it not even reach that decision, because the
 * guardrail already answered it for free?
 *
 * The "Knowledge" switch is a UI affordance; the rule lives here, beside
 * decideRoute, so it is testable with a plain object and LangGraph never owns
 * behaviour. Anything other than an explicit 'direct' means search — a typo
 * or a stale client must never silently disable the evidence path.
 *
 * Checked ahead of `mode` on purpose: "hi" is small talk whether or not
 * Knowledge is on, so a caller in 'direct' mode must get the same instant
 * reply as one in 'rag' mode, not a wasted direct_answer LLM call.
 *
 * @param {{question?: string, mode?: string, webMode?: string}} state
 * @param {{corpusProbe?: {has: (term: string) => boolean}|null, enabled?: boolean}} [triageOpts]
 *   forwarded verbatim into triage() — see this file's header comment on
 *   why both fields matter here specifically, not just for the node.
 * @returns {string} one of MODES
 */
function decideEntry(state, triageOpts) {
  if (triage(state, triageOpts).intercept) return MODES.SMALL_TALK;
  return decideEntryByMode(state);
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

module.exports = { decideRoute, decideEntry, decideEntryByMode };
