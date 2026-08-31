/**
 * Node: rewrite_query — broadens search keywords after a fruitless retrieval
 * (Corrective-RAG loop). Increments the attempt counter that caps the loop.
 */

const { REWRITE_SYSTEM } = require('../../infrastructure/llm/prompts');
const { buildMatchExpressions, keywordsFromQuestion } = require('../../infrastructure/persistence/ftsQuery');

/**
 * @param {{llm: import('../../domain/ports/LlmGateway').LlmGateway, logger: import('../../domain/ports/ChatLogger').ChatLogger}} deps
 */
function createRewriteQueryNode({ llm, logger }) {
  return async function rewriteQuery(state) {
    const nextAttempt = (state.attempt || 0) + 1;

    try {
      const { data } = await llm.complete({
        messages: [
          { role: 'system', content: REWRITE_SYSTEM },
          {
            role: 'user',
            content:
              `Question: ${state.question}\n` +
              `Keywords already tried: ${(state.searchQueries || []).join(' | ') || '(none)'}`,
          },
        ],
        expectJson: true,
        maxTokens: 300,
        tag: 'rewrite_query',
      });

      const keywords = Array.isArray(data?.searchKeywords)
        ? data.searchKeywords.filter((k) => typeof k === 'string' && k.trim())
        : [];
      let searchQueries = buildMatchExpressions(keywords);
      if (searchQueries.length === 0) throw new Error('rewrite produced no usable keywords');

      logger.info('rewrite_query', 'rewritten', { attempt: nextAttempt, queries: searchQueries.length });
      return { searchQueries, attempt: nextAttempt };
    } catch (err) {
      logger.warn('rewrite_query', 'llm_failed_degrading', { message: String(err.message).slice(0, 160) });
      // Deterministic broadening: individual OR-joined question keywords.
      const kws = keywordsFromQuestion(state.question);
      return {
        searchQueries: buildMatchExpressions(kws),
        attempt: nextAttempt,
        degradedNote: 'Query rewrite ran without the LLM (keyword fallback).',
      };
    }
  };
}

module.exports = { createRewriteQueryNode };
