/**
 * guardrail/triage — zero-LLM classification of an incoming question.
 *
 * PURE: no I/O, no clock, no randomness. Safe to call twice per turn once
 * this is wired into the graph (decideEntry calls it to route, smallTalkNode
 * calls it to render the reply) — see the pre-router plan, §04.
 *
 * SCOPE — all five classes are implemented: greeting / help / ack / empty /
 * gibberish.
 *
 * `ack` and `greeting` both stand down whenever a clarifying question is
 * pending (see pendingClarification.js) — a bare "yes" answering a real
 * clarifying question must never be swallowed as an acknowledgement, and a
 * "hi" mid-clarification is cheap enough to hand back to the graph rather
 * than special-case. `help` and `empty` do NOT stand down: asking for help,
 * or sending nothing at all, are not plausible replies to "do you want the
 * cause or the fix?", so there is no real ambiguity to protect there.
 * `gibberish` does not stand down either — noise typed mid-clarification is
 * still just noise, and nothing about a pending question makes it worth a
 * full pipeline attempt.
 *
 * `gibberish` is checked LAST, deliberately: it is the only check here that
 * can cost a real database query (the corpus gate, when the shape gate
 * alone cannot decide — see gibberish.js), so every cheap exact-match Set
 * lookup above it gets a chance to resolve the turn for free first.
 *
 * Nothing in this file imports LlmGateway, the OpenAI SDK, or
 * better-sqlite3, and nothing in guardrail/ imports from nodes/ — see the
 * pre-router plan §07 for why that boundary is an invariant, not a style
 * preference. gibberish.js's own corpusProbe parameter is what lets this
 * file check the corpus without violating that: the probe is handed in by
 * the composition root, never imported here.
 */

const { GREETING_TOKENS, HELP_TOKENS, AFFIRMATIVE_TOKENS, NEGATIVE_TOKENS } = require('./tokens');
const { normalize } = require('./normalize');
const { replyFor } = require('./replies');
const { hasPendingClarification } = require('./pendingClarification');
const { isGibberishMessage } = require('./gibberish');

/**
 * @typedef {Object} TriageResult
 * @property {boolean} intercept  false => fall through to the graph, unchanged
 * @property {'greeting'|'help'|'ack'|'gibberish'|'empty'|null} kind
 * @property {string} answer      canned, mode-aware; '' when intercept is false
 * @property {string[]} followUps same shape respond_no_data already returns
 * @property {string} reason      for the log line only, never shown to the user
 */

/** @returns {TriageResult} a well-formed non-interception result. */
function passThrough(reason) {
  return { intercept: false, kind: null, answer: '', followUps: [], reason };
}

/** @returns {TriageResult} */
function intercepted(kind, mode, reason) {
  const { answer, followUps } = replyFor(kind, mode);
  return { intercept: true, kind, answer, followUps, reason };
}

/**
 * @param {{question?: string, mode?: string}} state graph state (or any
 *   object shaped like it — kept structural so tests can pass plain objects,
 *   the same discipline routing.js already follows)
 * @param {{corpusProbe?: {has: (term: string) => boolean}|null, enabled?: boolean}} [opts]
 *   corpusProbe: backs the gibberish gate's corpus check (gibberish.js).
 *   Absent/null is treated the same as a probe that always finds the term —
 *   gibberish detection then relies on the shape gate alone, exactly the
 *   documented "cold start" degradation (see gibberish.js's isGibberishToken
 *   and CorpusProbe.js).
 *   enabled: the CHATBOT_GUARDRAIL kill switch (see envConfig.js, added in
 *   §09/phase 3). Defaults to true so a caller that omits it — a test, a
 *   future transport — gets triage active rather than silently disabled.
 * @returns {TriageResult}
 */
function triage(state, { corpusProbe = null, enabled = true } = {}) {
  if (!enabled) return passThrough('guardrail_disabled');

  const question = typeof state?.question === 'string' ? state.question : '';
  const key = normalize(question);
  const mode = state?.mode;

  if (key === '') return intercepted('empty', mode, 'normalized_to_empty');

  // Computed once: both branches below need it, and hasPendingClarification
  // is itself pure and cheap (two field reads, no I/O) — see that file.
  const pending = hasPendingClarification(state);

  if (GREETING_TOKENS.has(key)) {
    return pending
      ? passThrough('greeting_stood_down_pending_clarification')
      : intercepted('greeting', mode, 'exact_greeting_token');
  }

  if (HELP_TOKENS.has(key)) return intercepted('help', mode, 'exact_help_token');

  if (AFFIRMATIVE_TOKENS.has(key) || NEGATIVE_TOKENS.has(key)) {
    return pending
      ? passThrough('ack_stood_down_pending_clarification')
      : intercepted('ack', mode, 'exact_ack_token');
  }

  if (isGibberishMessage(question, corpusProbe)) {
    return intercepted('gibberish', mode, 'gibberish_shape_and_corpus');
  }

  return passThrough('no_match');
}

module.exports = { triage };
