/**
 * Shared tunables for the chat graph. Centralized so nodes never hardcode
 * magic numbers (Single Source of Truth; easy to promote to env config).
 */
module.exports = Object.freeze({
  /** Max retrieval attempts before giving up (initial + rewrites). */
  MAX_RETRIEVAL_ATTEMPTS: 2,
  /** Max raw hits pulled from FTS per question. */
  MAX_HITS: 24,
  /**
   * Max groups represented in the evidence sent to the LLM. A "group" is one
   * meeting or one document — grouping is by groupKey, not meetingId, because
   * documents have no meeting.
   */
  MAX_EVIDENCE_GROUPS: 4,
  /** Max snippets per group in the evidence sent to the LLM. */
  MAX_SNIPPETS_PER_GROUP: 5,
  /**
   * When both corpora return hits, guarantee at least this many groups from
   * each. Without it a 200-chunk PDF that ranks well can occupy every slot in
   * MAX_EVIDENCE_GROUPS and silently crowd meetings out of the answer.
   */
  MIN_GROUPS_PER_SOURCE_TYPE: 1,
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
