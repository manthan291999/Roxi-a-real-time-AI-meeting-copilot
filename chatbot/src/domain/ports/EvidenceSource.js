/**
 * Port: EvidenceSource — one corpus that can answer a question with evidence.
 *
 * Why this exists beside Retriever rather than replacing it: Retriever.search
 * takes sanitized FTS5 MATCH expressions, which a vector search cannot use,
 * and respondNoDataNode legitimately depends on Retriever.recentTopics().
 * Widening Retriever.search would force FtsRetriever to accept an argument it
 * does not want — an Interface Segregation violation — so this is a second,
 * narrower port instead. FtsRetriever is not modified.
 *
 * search() receives BOTH forms of the query and each adapter uses what it can:
 * lexical sources take matchExprs, semantic sources take question.
 *
 * Implementations must resolve rather than reject when their corpus is
 * unavailable — CompositeEvidenceSource treats a failing source as empty so
 * one broken corpus cannot take down the others.
 *
 * @typedef {Object} EvidenceHit
 * @property {'meeting'|'document'} sourceType
 * @property {string} groupKey     stable identity of the thing a hit belongs
 *   to ('meeting:3', 'doc:abc'). Replaces meetingId for grouping, since
 *   documents have no meeting.
 * @property {string} sourceTable  meetings: transcripts|summaries|decisions|
 *   action_items|risks. documents: 'documents'.
 * @property {string|number} sourceId row/chunk identity within sourceTable
 * @property {string} text
 * @property {number} score        source-native relevance, higher is better.
 *   NOT comparable across sources — BM25-derived and cosine live on different
 *   scales, which is why merging uses rank fusion rather than these values.
 * @property {number|null} [meetingId]
 * @property {string} [meetingDate]
 * @property {string} [speaker]
 * @property {string} [docId]
 * @property {string} [fileName]
 * @property {number|null} [pageNumber]
 *
 * Note: the citation token (`ref`, e.g. 'M3' / 'D2') is NOT set here. It is
 * scoped to a single answer, so it is assigned while evidence is bounded, not
 * by the source that produced the hit.
 *
 * @interface EvidenceSource
 * @property {string} name for logging and for the per-source quota
 * @method search
 *   @param {{question: string, matchExprs: string[], limit: number}} query
 *   @returns {Promise<EvidenceHit[]>} sorted best-first
 */
module.exports = {};
