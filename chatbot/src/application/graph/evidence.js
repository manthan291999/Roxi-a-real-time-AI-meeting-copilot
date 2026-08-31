/**
 * evidence — pure helpers shaping retrieved hits for prompts and payloads.
 * Kept dependency-free so the bounding/citation logic is unit-testable.
 */

const {
  MAX_EVIDENCE_MEETINGS,
  MAX_SNIPPETS_PER_MEETING,
} = require('./constants');

/**
 * Bound evidence for LLM context: top N meetings (by best score), each with
 * at most M snippets. Input must be pre-sorted best-first.
 * @param {import('../../domain/ports/Retriever').EvidenceHit[]} hits
 * @returns {import('../../domain/ports/Retriever').EvidenceHit[]}
 */
function boundEvidence(hits) {
  if (!Array.isArray(hits) || hits.length === 0) return [];
  const byMeeting = new Map();
  for (const h of hits) {
    if (!byMeeting.has(h.meetingId)) byMeeting.set(h.meetingId, []);
    const bucket = byMeeting.get(h.meetingId);
    if (bucket.length < MAX_SNIPPETS_PER_MEETING) bucket.push(h);
  }
  const orderedMeetings = [...byMeeting.keys()].slice(0, MAX_EVIDENCE_MEETINGS);
  return orderedMeetings.flatMap((id) => byMeeting.get(id));
}

/**
 * Map evidence hits to the protocol's source-card shape.
 * Optionally restrict to cited meeting ids (generate node).
 * @param {import('../../domain/ports/Retriever').EvidenceHit[]} hits
 * @param {number[]} [citedMeetingIds]
 * @returns {Array<{meetingId:number,date:string,speaker:string,snippet:string,sourceTable:string}>}
 */
function toSources(hits, citedMeetingIds = null) {
  if (!Array.isArray(hits)) return [];
  const cited = Array.isArray(citedMeetingIds) && citedMeetingIds.length
    ? new Set(citedMeetingIds.map(Number))
    : null;
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    if (cited && !cited.has(Number(h.meetingId))) continue;
    const key = `${h.meetingId}:${h.sourceTable}:${h.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      meetingId: Number(h.meetingId),
      date: h.meetingDate || '',
      speaker: h.speaker || '',
      snippet: h.text || '',
      sourceTable: h.sourceTable || '',
    });
  }
  return out;
}

module.exports = { boundEvidence, toSources };
