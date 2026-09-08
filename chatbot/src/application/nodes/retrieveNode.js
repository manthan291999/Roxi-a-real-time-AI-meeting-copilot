/**
 * Node: retrieve — searches every configured corpus for evidence.
 *
 * Depends on ONE EvidenceSource and cannot tell how many corpora sit behind
 * it; the composition root decides that. Both query forms are passed on
 * because lexical and semantic sources need different ones: the sanitized
 * FTS5 MATCH expressions in state.searchQueries, and the natural-language
 * question a vector search has to embed.
 *
 * Failures yield an empty hit list so routing can decide rewrite/no_data.
 */

const { MAX_HITS } = require('../graph/constants');

/**
 * @param {{evidenceSource: import('../../domain/ports/EvidenceSource').EvidenceSource, logger: import('../../domain/ports/ChatLogger').ChatLogger}} deps
 */
function createRetrieveNode({ evidenceSource, logger }) {
  return async function retrieve(state) {
    try {
      const hits = await evidenceSource.search({
        question: state.question || '',
        matchExprs: state.searchQueries || [],
        liveContext: state.liveContext || '',
        limit: MAX_HITS,
      });
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
