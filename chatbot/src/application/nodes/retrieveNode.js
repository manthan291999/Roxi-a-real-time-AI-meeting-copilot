/**
 * Node: retrieve — runs sanitized FTS queries against the chat index.
 * Pure retrieval: no LLM, no cost. Failures yield an empty hit list so the
 * routing logic can decide rewrite/no_data.
 */

const { MAX_HITS } = require('../graph/constants');

/**
 * @param {{retriever: import('../../domain/ports/Retriever').Retriever, logger: import('../../domain/ports/ChatLogger').ChatLogger}} deps
 */
function createRetrieveNode({ retriever, logger }) {
  return async function retrieve(state) {
    try {
      const hits = retriever.search(state.searchQueries || [], { limit: MAX_HITS });
      logger.info('retrieve', 'search_done', {
        queries: (state.searchQueries || []).length,
        hits: hits.length,
        attempt: state.attempt,
      });
      return { hits };
    } catch (err) {
      logger.error('retrieve', 'search_failed', { message: String(err.message).slice(0, 200) });
      return { hits: [], degradedNote: `Search failed: ${err.message}` };
    }
  };
}

module.exports = { createRetrieveNode };
