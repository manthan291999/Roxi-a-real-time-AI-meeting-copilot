/**
 * Node: direct_answer — the Knowledge switch turned off.
 *
 * One LLM call and no retrieval whatsoever: no FTS, no documents, no vector
 * memory, no live transcript. The user asked the model, not the archive, so
 * this node must never return sources — a citation here would claim grounding
 * that does not exist.
 *
 * It depends on the LlmGateway port only (same as every other node), so the
 * adapter behind it stays swappable.
 */

const { DIRECT_SYSTEM, toChatTurns } = require('../../infrastructure/llm/prompts');
const { DIRECT_HISTORY_TURNS, ROUTES } = require('../graph/constants');

/** Token cap. Higher than generate's: direct answers often carry code. */
const MAX_TOKENS = 1600;

/**
 * @param {{llm: import('../../domain/ports/LlmGateway').LlmGateway, logger: import('../../domain/ports/ChatLogger').ChatLogger}} deps
 */
function createDirectAnswerNode({ llm, logger }) {
  return async function directAnswer(state) {
    try {
      const { data, raw } = await llm.complete({
        messages: [
          { role: 'system', content: DIRECT_SYSTEM },
          ...toChatTurns(state.history, DIRECT_HISTORY_TURNS),
          { role: 'user', content: state.question },
        ],
        expectJson: true,
        maxTokens: MAX_TOKENS,
        tag: 'direct_answer',
      });

      // A long code answer can hit the cap and truncate the JSON, leaving
      // parseJsonLoose with nothing. Keep whatever prose came back rather than
      // failing the turn: unlike generate, there is no evidence to degrade to.
      const answer = data && data.answer
        ? String(data.answer).trim()
        : String(raw || '').trim();
      if (!answer) throw new Error('direct response empty');

      return {
        answer,
        sources: [],
        followUps: Array.isArray(data?.followUps)
          ? data.followUps.filter((f) => typeof f === 'string' && f.trim()).slice(0, 3)
          : [],
        route: ROUTES.DIRECT,
      };
    } catch (err) {
      logger.warn('direct_answer', 'llm_failed', { message: String(err.message).slice(0, 160) });
      return {
        answer:
          "I couldn't reach the model for that one. Try again, or switch Knowledge back "
          + 'on to answer from your meetings.',
        sources: [],
        followUps: [],
        route: ROUTES.DIRECT,
        degradedNote: 'Direct chat unavailable (LLM error).',
      };
    }
  };
}

module.exports = { createDirectAnswerNode };
