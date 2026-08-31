/**
 * buildChatGraph — composes the Ask-Roxi Adaptive-RAG StateGraph.
 *
 * Topology:
 *   START -> analyze_query -> retrieve -> grade_documents -> <decide>
 *     <decide>: generate | clarify | rewrite(->retrieve loop) | no_data
 *   generate/clarify/no_data -> END
 *
 * All dependencies arrive via the deps object (Dependency Inversion): this
 * module knows node factories and routing, never concrete adapters.
 */

const { StateGraph, START, END, MemorySaver } = require('@langchain/langgraph');
const { GraphState } = require('./state');
const { decideRoute } = require('./routing');
const { NODES, ROUTES } = require('./constants');

/**
 * @param {Object} deps injected node implementations (already constructed)
 * @param {Function} deps.analyzeQuery
 * @param {Function} deps.retrieve
 * @param {Function} deps.gradeDocuments
 * @param {Function} deps.rewriteQuery
 * @param {Function} deps.clarify
 * @param {Function} deps.generate
 * @param {Function} deps.respondNoData
 * @param {{checkpointer?: Object}} [opts] pass checkpointer:null to disable memory
 * @returns compiled LangGraph runnable
 */
function buildChatGraph(deps, { checkpointer = undefined } = {}) {
  const builder = new StateGraph(GraphState)
    .addNode(NODES.ANALYZE, deps.analyzeQuery)
    .addNode(NODES.RETRIEVE, deps.retrieve)
    .addNode(NODES.GRADE, deps.gradeDocuments)
    .addNode(NODES.REWRITE, deps.rewriteQuery)
    .addNode(NODES.CLARIFY, deps.clarify)
    .addNode(NODES.GENERATE, deps.generate)
    .addNode(NODES.NO_DATA, deps.respondNoData)

    .addEdge(START, NODES.ANALYZE)
    .addEdge(NODES.ANALYZE, NODES.RETRIEVE)
    .addEdge(NODES.RETRIEVE, NODES.GRADE)

    .addConditionalEdges(NODES.GRADE, decideRoute, {
      [ROUTES.GENERATE]: NODES.GENERATE,
      [ROUTES.CLARIFY]: NODES.CLARIFY,
      [ROUTES.REWRITE]: NODES.REWRITE,
      [ROUTES.NO_DATA]: NODES.NO_DATA,
    })

    .addEdge(NODES.REWRITE, NODES.RETRIEVE) // corrective loop
    .addEdge(NODES.GENERATE, END)
    .addEdge(NODES.CLARIFY, END)
    .addEdge(NODES.NO_DATA, END);

  // MemorySaver gives per-thread conversational state (multi-turn follow-ups).
  return builder.compile(
    checkpointer === null ? {} : { checkpointer: checkpointer ?? new MemorySaver() }
  );
}

module.exports = { buildChatGraph };
