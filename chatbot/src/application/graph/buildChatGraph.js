/**
 * buildChatGraph — composes the Ask-Roxi Adaptive-RAG StateGraph.
 *
 * Topology:
 *   START -> <decideEntry>
 *     'rag'        -> analyze_query -> retrieve -> grade_documents -> <decideRoute>
 *                     <decideRoute>: generate | generate_web | clarify
 *                                    | rewrite(->retrieve loop) | no_data
 *     'direct'     -> direct_answer                    (Knowledge OFF, Web OFF)
 *     'web_direct' -> web_answer                       (Knowledge OFF, Web ON)
 *   every leaf -> END
 *
 * The two web nodes are OPTIONAL dependencies. When they are absent — a
 * container built without an API key, or a test that wires only the classic
 * nodes — the web route values map to their non-web twins instead, so the
 * graph is byte-for-byte the old one rather than throwing on an unmapped
 * edge. That is what lets the existing graph tests keep passing unchanged,
 * and it means "no web capability configured" degrades instead of failing.
 *
 * All dependencies arrive via the deps object (Dependency Inversion): this
 * module knows node factories and routing, never concrete adapters.
 */

const { StateGraph, START, END, MemorySaver } = require('@langchain/langgraph');
const { GraphState } = require('./state');
const { decideRoute, decideEntry } = require('./routing');
const { NODES, ROUTES, MODES } = require('./constants');

/**
 * @param {Object} deps injected node implementations (already constructed)
 * @param {Function} deps.analyzeQuery
 * @param {Function} deps.retrieve
 * @param {Function} deps.gradeDocuments
 * @param {Function} deps.rewriteQuery
 * @param {Function} deps.clarify
 * @param {Function} deps.generate
 * @param {Function} deps.respondNoData
 * @param {Function} deps.directAnswer
 * @param {Function} [deps.webAnswer]    optional — Knowledge off + Web on
 * @param {Function} [deps.generateWeb]  optional — Knowledge on + Web on
 * @param {{checkpointer?: Object}} [opts] pass checkpointer:null to disable memory
 * @returns compiled LangGraph runnable
 */
function buildChatGraph(deps, { checkpointer = undefined } = {}) {
  const hasWebAnswer = typeof deps.webAnswer === 'function';
  const hasGenerateWeb = typeof deps.generateWeb === 'function';

  const builder = new StateGraph(GraphState)
    .addNode(NODES.ANALYZE, deps.analyzeQuery)
    .addNode(NODES.RETRIEVE, deps.retrieve)
    .addNode(NODES.GRADE, deps.gradeDocuments)
    .addNode(NODES.REWRITE, deps.rewriteQuery)
    .addNode(NODES.CLARIFY, deps.clarify)
    .addNode(NODES.GENERATE, deps.generate)
    .addNode(NODES.NO_DATA, deps.respondNoData)
    .addNode(NODES.DIRECT, deps.directAnswer);

  if (hasWebAnswer) builder.addNode(NODES.WEB_ANSWER, deps.webAnswer);
  if (hasGenerateWeb) builder.addNode(NODES.GENERATE_WEB, deps.generateWeb);

  builder
    // The Knowledge switch, and — when the web is on — which model-only leaf
    // it lands on. Either way the whole evidence path below is skipped.
    .addConditionalEdges(START, decideEntry, {
      [MODES.RAG]: NODES.ANALYZE,
      [MODES.DIRECT]: NODES.DIRECT,
      [MODES.WEB_DIRECT]: hasWebAnswer ? NODES.WEB_ANSWER : NODES.DIRECT,
    })
    .addEdge(NODES.ANALYZE, NODES.RETRIEVE)
    .addEdge(NODES.RETRIEVE, NODES.GRADE)

    .addConditionalEdges(NODES.GRADE, decideRoute, {
      [ROUTES.GENERATE]: NODES.GENERATE,
      [ROUTES.GENERATE_WEB]: hasGenerateWeb ? NODES.GENERATE_WEB : NODES.GENERATE,
      [ROUTES.CLARIFY]: NODES.CLARIFY,
      [ROUTES.REWRITE]: NODES.REWRITE,
      [ROUTES.NO_DATA]: NODES.NO_DATA,
    })

    .addEdge(NODES.REWRITE, NODES.RETRIEVE) // corrective loop
    .addEdge(NODES.GENERATE, END)
    .addEdge(NODES.CLARIFY, END)
    .addEdge(NODES.NO_DATA, END)
    .addEdge(NODES.DIRECT, END);

  if (hasWebAnswer) builder.addEdge(NODES.WEB_ANSWER, END);
  if (hasGenerateWeb) builder.addEdge(NODES.GENERATE_WEB, END);

  // MemorySaver gives per-thread conversational state (multi-turn follow-ups).
  return builder.compile(
    checkpointer === null ? {} : { checkpointer: checkpointer ?? new MemorySaver() }
  );
}

module.exports = { buildChatGraph };
