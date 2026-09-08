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
  /** @type {string} non-fatal internal error note (degraded paths) */
  degradedNote: Annotation({ reducer: lastWrite, default: () => '' }),
});

module.exports = { GraphState, lastWrite };
