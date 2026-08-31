/**
 * Port: Retriever — evidence search over the meeting corpus.
 *
 * Implementations must be read-only and safe to call concurrently.
 * (Dependency Inversion: application nodes depend ONLY on this contract.)
 *
 * @typedef {Object} EvidenceHit
 * @property {number} meetingId    meeting row id in the source DB
 * @property {string} meetingDate  meeting start_time (ISO-like string)
 * @property {string} sourceTable  one of: transcripts|summaries|decisions|action_items|risks
 * @property {number} sourceId     row id within sourceTable
 * @property {string} speaker      speaker label ('' for non-transcript sources)
 * @property {string} text         matched text (trimmed to a bounded length)
 * @property {number} score        BM25-derived relevance (higher = better)
 *
 * @interface Retriever
 * @method search        @param {string[]} queries @param {{limit?: number}} [opts] @returns {EvidenceHit[]}
 * @method recentTopics  @param {number} [limit] @returns {Array<{meetingId:number, meetingDate:string, topic:string}>}
 */
module.exports = {};
