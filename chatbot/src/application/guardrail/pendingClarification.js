/**
 * guardrail/pendingClarification.js — is this turn a reply to a clarifying
 * question the previous turn asked?
 *
 * This exists for exactly one trap: the clarify route ends a turn with a
 * question and up to three options. If the next message is "yes" or "sure"
 * and the guardrail intercepts it as a bare acknowledgement, the user's
 * actual answer is swallowed and replaced with "Anything else?" — a worse
 * failure than the pipeline cost this whole feature exists to cut, because
 * it loses information the user supplied. triage.js stands down `ack` (and,
 * cheaply, `greeting`) whenever this returns true.
 *
 * TWO INDEPENDENT SIGNALS, because either alone can be missing:
 *
 *   1. state.route === ROUTES.CLARIFY — the graph's own checkpointed state.
 *      GraphState's `route` channel uses the `lastWrite` reducer (state.js):
 *      an absent value on the NEXT turn's input is ignored, so `route` from
 *      the clarify turn survives into this turn's initial state before any
 *      node — including this guardrail — has run. That staleness is exactly
 *      the hazard state.js warns callers about for `mode`/`webMode`; here it
 *      is precisely the signal this function wants. It only survives within
 *      one running chatbot sidecar process for one thread, though — a
 *      sidecar restart between turns loses it, which is what signal 2 is for.
 *
 *   2. The last entry in state.history is an assistant turn whose content
 *      ends in '?' — survives a sidecar restart, since every caller in this
 *      codebase re-sends the full history on each Ask.
 *
 *      KNOWN GAP, found while implementing this: as of this writing NEITHER
 *      real caller — src/features/chat/useChatThread.ts, nor
 *      chatbot/src/transport/cliRepl.js — actually stores the clarifying
 *      question as that history entry's `content`. Both store
 *      `payload.answer` instead (the summary sentence, e.g. "I found
 *      related discussion in 2 meetings."), which clarifyNode.js ALWAYS
 *      returns non-empty (either the LLM's summary or a hardcoded
 *      fallback), so it never ends in '?'. useChatThread.ts's own comment
 *      ("on the clarify route `answer` is empty, so it has to be part of
 *      the fallback chain") is stale relative to the current
 *      clarifyNode.js, which never leaves `answer` empty — so that
 *      fallback's second branch (`reply?.clarifyingQuestion`) never runs in
 *      practice today. Signal 2 is implemented exactly as specified below
 *      regardless: it is correct for any caller that DOES store the
 *      question as content, forward-compatible the moment either shipped
 *      caller starts doing so, and harmless while it doesn't. Signal 1 is
 *      what actually protects a live, continuous conversation today — a
 *      sidecar restart mid-clarification is the narrow gap this doesn't
 *      close. Fixing either caller's history shape is a frontend/CLI change
 *      outside this chatbot-only phase and is not made here.
 *
 * If EITHER signal fires, this returns true and triage.js does not
 * intercept.
 */

const { ROUTES } = require('../graph/constants');

/**
 * @param {{route?: string, history?: Array<{role?: string, content?: string}>}} state
 * @returns {boolean}
 */
function hasPendingClarification(state) {
  if (state?.route === ROUTES.CLARIFY) return true;

  const history = Array.isArray(state?.history) ? state.history : [];
  const last = history[history.length - 1];
  return Boolean(
    last
    && last.role === 'assistant'
    && typeof last.content === 'string'
    && last.content.trim().endsWith('?')
  );
}

module.exports = { hasPendingClarification };
