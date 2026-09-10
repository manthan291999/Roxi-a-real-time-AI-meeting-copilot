/**
 * Port: ChunkStore — read-only access to analyzed chunks, for episodic
 * memory sync (Meeting Semantic Memory plan, §05/§09).
 *
 * Deliberately narrower than MeetingStore rather than widening it (ISP,
 * same precedent as EvidenceSource sitting beside Retriever): FtsIndexBuilder
 * and friends never need chunk-level joins to decisions/risks/action_items,
 * and this store never needs FTS's raw-transcript/summary scan.
 *
 * @typedef {Object} ChunkRecord
 * @property {number} id
 * @property {number} meetingId
 * @property {number} chunkSeq        chunks.seq — order within the meeting
 * @property {number|null} projectId
 * @property {string|null} displayId
 * @property {string} speaker
 * @property {string} text
 * @property {string|null} topic
 * @property {string|null} significance   raw column value; low|medium|high|null
 * @property {string} createdAt       chunks.created_at — when it was SPOKEN,
 *                                     the clock the recency term (§05) uses
 * @property {string} meetingStartTime
 * @property {string|null} meetingContext
 * @property {number[]} linkedDecisionIds
 * @property {number[]} linkedRiskIds
 * @property {number[]} linkedActionItemIds
 *
 * @interface ChunkStore
 * @method chunksSince  @param {number} sinceId @returns {ChunkRecord[]} id > sinceId, ordered by id
 * @method chunksByIds  @param {number[]} ids    @returns {ChunkRecord[]} unordered
 * @method close
 */
module.exports = {};
