/**
 * webPolicy — PURE mapping from the caller's web mode to tool availability.
 *
 * This is the application-level half of the feature's central rule. It answers
 * "which tools does this turn get", and nothing else. Whether a search is
 * actually NEEDED is the model's decision, made inside the single Responses
 * call — there is deliberately no classifier here, and no LLM call.
 *
 * Lives beside routing.js, and for the same reasons: it encodes a rule, it
 * does no I/O, and it should be provable with plain objects.
 */

const { WEB_MODES } = require('./constants');

/**
 * Coerce anything into a known mode.
 *
 * Unrecognised means OFF — the cheap, private path. This is the mirror image
 * of decideEntry's rule about 'direct', and it exists for the same reason: a
 * typo or a stale client must never silently change what a turn costs or
 * where the question travels. Note the asymmetry with `mode`, which defaults
 * to the EXPENSIVE option (search the corpora) because there the safe answer
 * is "use the evidence"; here the safe answer is "stay local".
 *
 * The PRODUCT default ('auto') is applied one layer up, in
 * AnswerQuestionUseCase, from config — not here.
 *
 * @param {*} value
 * @returns {'auto'|'always'|'never'}
 */
function normalizeWebMode(value) {
  return value === WEB_MODES.AUTO || value === WEB_MODES.ALWAYS
    ? value
    : WEB_MODES.NEVER;
}

/**
 * @param {*} webMode
 * @returns {{enabled: boolean, toolChoice: 'auto'|'required'|'none', mandatory: boolean}}
 *   enabled   — send the tool at all
 *   toolChoice— what to put in the request
 *   mandatory — the caller asked specifically for sourced facts, which
 *               changes how a failure must be handled: 'auto' may quietly
 *               fall back to an unsourced answer, 'always' may not.
 */
function decideWebTools(webMode) {
  switch (normalizeWebMode(webMode)) {
    case WEB_MODES.ALWAYS:
      return { enabled: true, toolChoice: 'required', mandatory: true };
    case WEB_MODES.AUTO:
      return { enabled: true, toolChoice: 'auto', mandatory: false };
    default:
      // No tool in the request body. A capability the model cannot see is
      // one no prompt can argue it into using.
      return { enabled: false, toolChoice: 'none', mandatory: false };
  }
}

module.exports = { normalizeWebMode, decideWebTools };
