/**
 * Graph state contract for the Ask-Roxi Adaptive-RAG graph.
 *
 * Single source of truth for what flows between nodes. Every channel uses a
 * last-write-wins reducer (nodes own distinct channels, so there are no
 * concurrent writers per channel).
 */

const { Annotation } = require('@langchain/langgraph');

/** Replace-with-new-value reducer; `undefined`/`null` updates are ignored. */
const lastWrite = (prev, next) => (next === undefined || next === null ? prev : next);

const GraphState = Annotation.Root({
  // ---- Inputs -----------------------------------------------------------
  /** @type {string} the user's current question */
  question: Annotation({ reducer: lastWrite, default: () => '' }),
  /** @type {Array<{role:string,content:string}>} prior turns (rehydration) */
  history: Annotation({ reducer: lastWrite, default: () => [] }),
  /** @type {string} recent lines from the meeting currently being recorded, if any */
  liveContext: Annotation({ reducer: lastWrite, default: () => '' }),
  /**
   * @type {'rag'|'direct'} which entry path this turn takes.
   *
   * Set per question by the caller, never by a node. `lastWrite` ignores an
   * absent value and the graph is checkpointed per thread, so a turn that
   * omits it inherits the previous turn's mode — AnswerQuestionUseCase
   * therefore normalizes it to a concrete value on every run.
   */
  mode: Annotation({ reducer: lastWrite, default: () => 'rag' }),
  /**
   * @type {'auto'|'always'|'never'} may this turn reach the web.
   *
   * Independent of `mode` (see WEB_MODES). Defaults to 'never' HERE on
   * purpose, even though the product default is 'auto': the graph and its
   * pure decision functions must treat an unset value as off, so that a
   * caller who knows nothing about web search gets exactly the behaviour it
   * had before. The 'auto' default is applied one layer up, in
   * AnswerQuestionUseCase, from config.
   *
   * Carries the same hazard as `mode` above — lastWrite ignores an absent
   * value and the graph is checkpointed per thread, so a turn that omitted
   * it would inherit the previous turn's. The use case normalizes it on
   * every run for exactly that reason.
   */
  webMode: Annotation({ reducer: lastWrite, default: () => 'never' }),

  // ---- analyze_query outputs --------------------------------------------
  /** @type {string[]} sanitized FTS match expressions */
  searchQueries: Annotation({ reducer: lastWrite, default: () => [] }),
  /** @type {boolean} true when the question is under-specified */
  isAmbiguous: Annotation({ reducer: lastWrite, default: () => false }),
  /** @type {string} what exactly is unclear (used by clarify node) */
  ambiguityNote: Annotation({ reducer: lastWrite, default: () => '' }),

  // ---- retrieve / grade outputs -------------------------------------------
  /** @type {import('../domain/ports/Retriever').EvidenceHit[]} raw hits */
  hits: Annotation({ reducer: lastWrite, default: () => [] }),
  /** @type {import('../domain/ports/Retriever').EvidenceHit[]} graded relevant subset */
  evidence: Annotation({ reducer: lastWrite, default: () => [] }),

  // ---- loop control -------------------------------------------------------
  /** @type {number} retrieval attempts so far (rewrite loop cap) */
  attempt: Annotation({ reducer: lastWrite, default: () => 0 }),
  /** @type {string} last routing decision: generate|clarify|rewrite|no_data */
  route: Annotation({ reducer: lastWrite, default: () => '' }),

  // ---- Outputs ------------------------------------------------------------
  /** @type {string} grounded answer (markdown-lite) */
  answer: Annotation({ reducer: lastWrite, default: () => '' }),
  /** @type {Array<{meetingId:number,date:string,speaker:string,snippet:string,sourceTable:string}>} */
  sources: Annotation({ reducer: lastWrite, default: () => [] }),
  /** @type {string} ONE clarifying question when route=clarify */
  clarifyingQuestion: Annotation({ reducer: lastWrite, default: () => '' }),
  /** @type {string[]} suggested follow-up questions */
  followUps: Annotation({ reducer: lastWrite, default: () => [] }),
  /**
   * @type {boolean} did the model actually search the web on this turn.
   *
   * Counted from the provider's web_search_call items, never inferred from
   * the prose — it is the ground truth behind every metric this feature
   * reports, and the answer to "is 'auto' tuned right".
   */
  usedWebSearch: Annotation({ reducer: lastWrite, default: () => false }),
  /** @type {number} how many searches the model ran. */
  webSearchCount: Annotation({ reducer: lastWrite, default: () => 0 }),
  /** @type {string} non-fatal internal error note (degraded paths) */
  degradedNote: Annotation({ reducer: lastWrite, default: () => '' }),
  /**
   * @type {''|'greeting'|'help'|'ack'|'gibberish'|'empty'} which guardrail
   * class intercepted this turn (application/guardrail/triage.js), or '' on
   * any turn the guardrail did not intercept. Set only by smallTalkNode.
   *
   * AnswerQuestionUseCase's own `finalState` is built from the per-node
   * update STREAM for the CURRENT invocation only (streamMode:'updates'),
   * not a full state read — so unlike `route`, which nodes read the full
   * checkpointed value of (pendingClarification.js's signal 1 relies on
   * exactly that), this channel's persistence across turns in the
   * checkpointer is harmless: nothing reads a PRIOR turn's guardrail kind,
   * and the payload this becomes (AnswerQuestionUseCase's `guardrail`
   * field) only ever reflects what ran in the current turn.
   */
  guardrail: Annotation({ reducer: lastWrite, default: () => '' }),
});

module.exports = { GraphState, lastWrite };
