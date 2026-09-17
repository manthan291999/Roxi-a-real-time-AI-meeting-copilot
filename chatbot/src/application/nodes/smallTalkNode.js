/**
 * Node: small_talk — the zero-LLM guardrail's terminal.
 *
 * Reached ONLY when decideEntry already called triage() on this exact state
 * and got intercept:true (see graph/routing.js). This node calls triage()
 * again, on the same state, to render the canned reply — triage() is pure
 * and documented as safe to call twice per turn for exactly this reason
 * (see guardrail/triage.js's own doc comment): LangGraph's conditional edges
 * return a routing key, not a value that gets persisted into graph state, so
 * there is no channel to hand decideEntry's decision forward without one.
 *
 * No LLM call, no retrieval, no I/O — the same shape as respondNoDataNode,
 * this graph's other zero-LLM terminal.
 */

const { ROUTES } = require('../graph/constants');
const { triage } = require('../guardrail/triage');

/**
 * @param {{logger?: import('../../domain/ports/ChatLogger').ChatLogger,
 *          corpusProbe?: {has: (term: string) => boolean}|null}} [deps]
 *   corpusProbe: backs the gibberish gate (guardrail/gibberish.js). MUST be
 *   the same instance passed as buildChatGraph's `deps.corpusProbe` — see
 *   that file's header comment for why decideEntry (routing) and this node
 *   (rendering) have to agree.
 */
function createSmallTalkNode({ logger = null, corpusProbe = null } = {}) {
  return async function smallTalk(state) {
    const decision = triage(state, { corpusProbe });

    if (!decision.intercept) {
      // Defensive only: decideEntry only routes here after triage() already
      // returned intercept:true on this same state. Reaching this branch
      // means the two calls disagreed — evidence of a bug, not a case any
      // real turn should hit. Degrade rather than throw, same posture every
      // other node in this graph takes on its own failure paths.
      logger?.warn('small_talk', 'reentry_mismatch', {
        question: String(state.question || '').slice(0, 120),
      });
      return {
        answer: '',
        sources: [],
        followUps: [],
        route: ROUTES.SMALL_TALK,
        guardrail: '',
        degradedNote: 'Guardrail routed here but did not classify the turn on re-entry.',
      };
    }

    logger?.info('small_talk', 'intercepted', {
      kind: decision.kind,
      reason: decision.reason,
      questionPreview: String(state.question || '').slice(0, 60),
    });

    return {
      answer: decision.answer,
      sources: [],
      followUps: decision.followUps,
      route: ROUTES.SMALL_TALK,
      // Echoed onto the ChatReply payload by AnswerQuestionUseCase — see
      // state.js's own doc comment on why this channel is safe to persist
      // across turns in the checkpointer.
      guardrail: decision.kind,
    };
  };
}

module.exports = { createSmallTalkNode };
