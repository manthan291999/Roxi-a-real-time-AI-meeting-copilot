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
   * Prior chat turns included in the direct-chat prompt. Higher than
   * HISTORY_TURNS on purpose: the RAG path carries context in its evidence
   * block, while direct chat has none — history IS the context there.
   */
  DIRECT_HISTORY_TURNS: 12,
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
  /**
   * Token cap for the web-search path. Higher than generate's 1200: a cited
   * answer spends tokens on attribution that an evidence-only answer does not.
   */
  WEB_MAX_TOKENS: 1800,
  /**
   * Web source cards per answer, after de-duplication by URL. A search can
   * return a dozen near-identical results; six distinct domains is already
   * more provenance than anyone reads.
   */
  WEB_MAX_CITATIONS: 6,
  /** Node names surfaced as ChatThinking events (protocol stability). */
  NODES: Object.freeze({
    ANALYZE: 'analyze_query',
    RETRIEVE: 'retrieve',
    GRADE: 'grade_documents',
    REWRITE: 'rewrite_query',
    CLARIFY: 'clarify',
    GENERATE: 'generate',
    NO_DATA: 'respond_no_data',
    DIRECT: 'direct_answer',
    /** Web tool, no corpus (Knowledge off + Web on). */
    WEB_ANSWER: 'web_answer',
    /** Web tool alongside retrieved evidence (Knowledge on + Web on). */
    GENERATE_WEB: 'generate_web',
  }),
  /** Routing decisions (conditional-edge vocabulary). */
  ROUTES: Object.freeze({
    GENERATE: 'generate',
    CLARIFY: 'clarify',
    REWRITE: 'rewrite',
    NO_DATA: 'no_data',
    DIRECT: 'direct',
    WEB: 'web',
    GENERATE_WEB: 'generate_web',
  }),
  /**
   * Ask modes — the entry-edge vocabulary, chosen by the caller rather than
   * by the graph. 'rag' consults every evidence source; 'direct' talks to the
   * model alone (no FTS, no documents, no vectors, no live transcript).
   */
  MODES: Object.freeze({
    RAG: 'rag',
    DIRECT: 'direct',
    /**
     * 'direct' with the web tool available: still no corpus, but the model
     * may go and look something up. A separate entry value rather than a
     * flag on 'direct' so the graph edge stays a pure lookup.
     */
    WEB_DIRECT: 'web_direct',
  }),
  /**
   * Web-search modes — the second, INDEPENDENT axis beside MODES.
   *
   * MODES answers "which of our corpora may this turn read". WEB_MODES
   * answers "may this turn reach outside". They are orthogonal: a user who
   * turned Knowledge off has said nothing about the web, and "compare our
   * design with current practice" needs both at once.
   *
   * 'auto'   — the tool is offered; the MODEL decides whether to search.
   * 'always' — the tool is forced (research / fact-check mode).
   * 'never'  — the tool is not sent at all. Enforcement is structural, not
   *            a prompt instruction the model could talk itself around.
   */
  WEB_MODES: Object.freeze({
    AUTO: 'auto',
    ALWAYS: 'always',
    NEVER: 'never',
  }),
});
