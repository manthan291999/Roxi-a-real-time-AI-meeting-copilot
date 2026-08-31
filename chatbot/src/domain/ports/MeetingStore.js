/**
 * Port: MeetingStore — read-only access to the raw meeting database.
 *
 * The chatbot NEVER writes to this store; it only reads rows to build its
 * own search index (separation of bounded contexts).
 *
 * @typedef {Object} SourceRow
 * @property {string} sourceTable  transcripts|summaries|decisions|action_items|risks
 * @property {number} sourceId     row id within that table
 * @property {number} meetingId    owning meeting id
 * @property {string} speaker      speaker label ('' when not applicable)
 * @property {string} text         indexable text
 *
 * @typedef {Object} MeetingRow
 * @property {number} id
 * @property {string} start_time
 * @property {string|null} end_time
 * @property {string} status
 * @property {string|null} context
 *
 * @interface MeetingStore
 * @method listMeetings   @returns {MeetingRow[]}
 * @method meetingDates   @returns {Map<number, string>} meetingId -> start_time
 * @method iterSourceRows @returns {SourceRow[]} all indexable rows (bounded corpus)
 * @method close          releases the DB handle
 */
module.exports = {};
