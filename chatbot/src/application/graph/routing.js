/**
 * routing — PURE decision logic for the graph's conditional edge.
 * Isolated from LangGraph so it can be unit-tested with plain objects.
 *
 * Decision table (evaluated after grade_documents):
 *   no evidence + attempts left  -> rewrite  (Corrective-RAG loop)
 *   no evidence + attempts spent -> no_data
 *   evidence + ambiguous question-> clarify  (ask what exactly)
 *   evidence + clear question    -> generate
 */

const { MAX_RETRIEVAL_ATTEMPTS, ROUTES } = require('./constants');

/**
 * @param {{evidence?: Array, attempt?: number, isAmbiguous?: boolean}} state
 * @returns {string} one of ROUTES
 */
function decideRoute(state) {
  const hasEvidence = Array.isArray(state.evidence) && state.evidence.length > 0;
  const attempt = state.attempt || 0;

  if (!hasEvidence) {
    return attempt < MAX_RETRIEVAL_ATTEMPTS ? ROUTES.REWRITE : ROUTES.NO_DATA;
  }
  if (state.isAmbiguous) return ROUTES.CLARIFY;
  return ROUTES.GENERATE;
}

module.exports = { decideRoute };
