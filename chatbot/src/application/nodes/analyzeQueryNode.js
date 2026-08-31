/**
 * Node: analyze_query — converts the user question into safe FTS keywords
 * and flags ambiguity. Degrades to naive keyword extraction if the LLM is
 * unavailable (the graph must never hard-fail on a flaky model).
 */

const { ANALYZE_SYSTEM } = require('../../infrastructure/llm/prompts');
const { formatHistory } = require('../../infrastructure/llm/prompts');
const { buildMatchExpressions, keywordsFromQuestion } = require('../../infrastructure/persistence/ftsQuery');
const { HISTORY_TURNS } = require('../graph/constants');

/**
 * @param {{llm: import('../../domain/ports/LlmGateway').LlmGateway, logger: import('../../domain/ports/ChatLogger').ChatLogger}} deps
 */
function createAnalyzeQueryNode({ llm, logger }) {
  return async function analyzeQuery(state) {
    const historyBlock = formatHistory(state.history, HISTORY_TURNS);
    const userMsg =
      (historyBlock ? `Prior conversation:\n${historyBlock}\n\n` : '') +
      `User question: ${state.question}`;

    try {
      const { data } = await llm.complete({
        messages: [
          { role: 'system', content: ANALYZE_SYSTEM },
          { role: 'user', content: userMsg },
        ],
        expectJson: true,
        maxTokens: 400,
        tag: 'analyze_query',
      });

      const keywords = Array.isArray(data?.searchKeywords)
        ? data.searchKeywords.filter((k) => typeof k === 'string' && k.trim())
        : [];
      let searchQueries = buildMatchExpressions(keywords);
      if (searchQueries.length === 0) {
        searchQueries = buildMatchExpressions(keywordsFromQuestion(state.question));
      }

      return {
        searchQueries,
        isAmbiguous: Boolean(data?.isAmbiguous),
        ambiguityNote: typeof data?.ambiguityNote === 'string' ? data.ambiguityNote : '',
      };
    } catch (err) {
      logger.warn('analyze_query', 'llm_failed_degrading', { message: String(err.message).slice(0, 160) });
      return {
        searchQueries: buildMatchExpressions(keywordsFromQuestion(state.question)),
        isAmbiguous: false,
        ambiguityNote: '',
        degradedNote: 'Query analysis ran without the LLM (keyword fallback).',
      };
    }
  };
}

module.exports = { createAnalyzeQueryNode };
