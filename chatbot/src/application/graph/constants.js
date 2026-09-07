/**
 * Shared tunables for the chat graph. Centralized so nodes never hardcode
 * magic numbers (Single Source of Truth; easy to promote to env config).
 */
module.exports = Object.freeze({
  /** Max retrieval attempts before giving up (initial + rewrites). */
  MAX_RETRIEVAL_ATTEMPTS: 2,
  /** Max raw hits pulled from FTS per question. */
  MAX_HITS: 24,
  /** Max meetings represented in the evidence sent to the LLM. */
  MAX_EVIDENCE_MEETINGS: 4,
  /** Max snippets per meeting in the evidence sent to the LLM. */
  MAX_SNIPPETS_PER_MEETING: 5,
  /** Max chars per snippet (keeps prompts bounded). */
  SNIPPET_MAX_CHARS: 600,
  /** Prior chat turns included in the generate prompt. */
  HISTORY_TURNS: 6,
  /**
   * Reciprocal Rank Fusion constant, from the original paper. Larger values
   * flatten the difference between ranks; 60 keeps rank 1 and rank 2 close
   * enough that agreement between two sources outweighs a single source's
   * top hit.
   */
  RRF_K: 60,
  /**
   * Vector hits below this cosine similarity are noise. Without a floor every
   * question returns its top-k chunks however irrelevant, and grade_documents
   * burns tokens rejecting them.
   */
  MIN_COSINE_SIMILARITY: 0.25,
  /** Node names surfaced as ChatThinking events (protocol stability). */
  NODES: Object.freeze({
    ANALYZE: 'analyze_query',
    RETRIEVE: 'retrieve',
    GRADE: 'grade_documents',
    REWRITE: 'rewrite_query',
    CLARIFY: 'clarify',
    GENERATE: 'generate',
    NO_DATA: 'respond_no_data',
  }),
  /** Routing decisions (conditional-edge vocabulary). */
  ROUTES: Object.freeze({
    GENERATE: 'generate',
    CLARIFY: 'clarify',
    REWRITE: 'rewrite',
    NO_DATA: 'no_data',
  }),
});
