/**
 * buildChatGraph — composes the Ask-Roxi Adaptive-RAG StateGraph.
 *
 * Topology:
 *   START -> <decideEntry>
 *     'small_talk' -> small_talk                        (guardrail intercept — zero LLM)
 *     'rag'        -> analyze_query -> retrieve -> grade_documents -> <decideRoute>
 *                     <decideRoute>: generate | generate_web | clarify
 *                                    | rewrite(->retrieve loop) | no_data
 *     'direct'     -> direct_answer                    (Knowledge OFF, Web OFF)
 *     'web_direct' -> web_answer                       (Knowledge OFF, Web ON)
 *   every leaf -> END
 *
 * decideEntry checks the guardrail BEFORE the mode/webMode axis — 'small_talk'
 * can be reached from what would otherwise have been any of the other three,
 * so it is listed first here but is not a fourth peer of equal weight; it is
 * a short-circuit ahead of them.
 *
 * small_talk and the two web nodes are OPTIONAL dependencies. When either web
 * node is absent, its route value maps to a fallback node instead, so the
 * graph degrades rather than throwing on an unmapped edge. small_talk is
 * degraded differently, because a single fixed fallback node cannot be
 * correct for it: with the guardrail off, a turn decideEntry would have
 * classified as MODES.SMALL_TALK has to land wherever decideEntryByMode
 * alone says — ANALYZE for a 'rag' turn, but DIRECT or WEB_ANSWER for a
 * 'direct' one — and that depends on state.mode, which one static mapping
 * entry cannot express. So entryDecider (below) always passes its own
 * `enabled: hasSmallTalk` straight into decideEntry -> triage(): when
 * false, triage() always returns intercept:false regardless of content,
 * and decideEntry falls through to decideEntryByMode(state) entirely on
 * its own — no post-hoc re-derivation needed here. That is what makes
 * "capability not configured" a true no-op rather than a mode-dependent
 * bug, and what lets the existing graph tests keep passing unchanged with
 * no smallTalk dependency supplied at all.
 *
 * entryDecider also forwards `deps.corpusProbe` into every decideEntry
 * call, whether or not the guardrail is enabled — this is what lets the
 * gibberish gate's corpus check agree between the ROUTING decision
 * (decideEntry, here) and the RENDERING decision (smallTalkNode, which
 * gets the same probe from the composition root). Without it, decideEntry
 * would silently classify with no probe at all, and a gibberish message
 * would never even be routed to small_talk for the node to catch — see
 * routing.js's own header comment for the full argument.
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
 * @param {Function} [deps.smallTalk]    optional — zero-LLM guardrail terminal;
 *   absent means CHATBOT_GUARDRAIL=off, and every turn behaves exactly as it
 *   did before this feature existed (see composition/container.js)
 * @param {{has: (term: string) => boolean}|null} [deps.corpusProbe] backs
 *   the guardrail's gibberish gate — see this file's header comment. Should
 *   be the SAME instance passed to whatever constructed deps.smallTalk.
 * @param {{checkpointer?: Object}} [opts] pass checkpointer:null to disable memory
 * @returns compiled LangGraph runnable
 */
function buildChatGraph(deps, { checkpointer = undefined } = {}) {
  const hasWebAnswer = typeof deps.webAnswer === 'function';
  const hasGenerateWeb = typeof deps.generateWeb === 'function';
  const hasSmallTalk = typeof deps.smallTalk === 'function';

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
  if (hasSmallTalk) builder.addNode(NODES.SMALL_TALK, deps.smallTalk);

  const entryDecider = (state) => decideEntry(state, {
    corpusProbe: deps.corpusProbe,
    enabled: hasSmallTalk,
  });

  builder
    // The guardrail, then the Knowledge switch, and — when the web is on —
    // which model-only leaf it lands on. Any non-small_talk branch below
    // skips the guardrail entirely; small_talk skips everything below it.
    .addConditionalEdges(START, entryDecider, {
      // LangGraph validates every mapping value against the registered node
      // set at compile() time regardless of reachability, so this must still
      // resolve to a real node even though entryDecider provably never
      // returns MODES.SMALL_TALK when !hasSmallTalk — it is a dead branch,
      // not a missing one. NODES.ANALYZE is always registered (above), so
      // it is always a valid, if inert, placeholder here.
      [MODES.SMALL_TALK]: hasSmallTalk ? NODES.SMALL_TALK : NODES.ANALYZE,
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
  if (hasSmallTalk) builder.addEdge(NODES.SMALL_TALK, END);

  // MemorySaver gives per-thread conversational state (multi-turn follow-ups).
  return builder.compile(
    checkpointer === null ? {} : { checkpointer: checkpointer ?? new MemorySaver() }
  );
}

module.exports = { buildChatGraph };
