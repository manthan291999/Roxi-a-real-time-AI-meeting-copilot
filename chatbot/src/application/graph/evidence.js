/**
 * evidence — pure helpers shaping retrieved hits for prompts and payloads.
 * Kept dependency-free so the bounding/citation logic is unit-testable.
 *
 * Citation model: every hit belongs to a GROUP (one meeting or one document,
 * identified by groupKey) and every group gets a REF — the token the model
 * cites and the UI matches against. Refs are assigned here, while evidence is
 * bounded, because they are scoped to a single answer: 'D2' means "the second
 * document in this answer" and means nothing outside it. Meeting refs stay
 * 'M<meetingId>', which is the vocabulary the shipped prompt already used, so
 * a meeting-only answer is unchanged by this module.
 */

const {
  MAX_EVIDENCE_GROUPS,
  MAX_SNIPPETS_PER_GROUP,
  MIN_GROUPS_PER_SOURCE_TYPE,
} = require('./constants');

/**
 * Which corpus a hit came from. EvidenceSource adapters stamp sourceType; the
 * fallbacks cover hits assembled by hand (tests, older callers) and default
 * to 'meeting' — the vocabulary the shipped prompt already used.
 * 'semantic' is glossary/vocabulary knowledge (SemanticMemoryEvidenceSource)
 * — cross-meeting by nature (meetingId is always null), so it must NOT fall
 * through to the 'meeting' default below: that would derive a citation from
 * a hit that has no meeting at all, reproducing the exact "Meeting #0" bug
 * toSources()'s own doc comment already warns about, just for a new source
 * type that was never added to this allow-list.
 * @returns {'meeting'|'document'|'live'|'semantic'}
 */
function sourceTypeOf(hit) {
  if (
    hit.sourceType === 'meeting' ||
    hit.sourceType === 'document' ||
    hit.sourceType === 'live' ||
    hit.sourceType === 'semantic'
  ) {
    return hit.sourceType;
  }
  return hit.docId ? 'document' : 'meeting';
}

/** Stable identity of the thing a hit belongs to, derived if not stamped. */
function groupKeyOf(hit) {
  if (hit.groupKey) return String(hit.groupKey);
  const type = sourceTypeOf(hit);
  if (type === 'document') return `doc:${hit.docId}`;
  if (type === 'live') return 'live:current';
  return `meeting:${hit.meetingId}`;
}

/**
 * Pick which groups make it into the answer.
 *
 * Plain rank order, except that when both corpora contributed we first reserve
 * MIN_GROUPS_PER_SOURCE_TYPE for each so neither can be shut out entirely.
 * The result is returned in rank order regardless of how it was chosen.
 */
function selectGroups(ranked) {
  if (ranked.length <= MAX_EVIDENCE_GROUPS) return ranked;

  const types = [...new Set(ranked.map((g) => g.sourceType))];
  // With one corpus the quota is already satisfied by definition.
  if (types.length < 2) return ranked.slice(0, MAX_EVIDENCE_GROUPS);

  const picked = new Set();
  for (const type of types) {
    let taken = 0;
    for (const g of ranked) {
      if (taken >= MIN_GROUPS_PER_SOURCE_TYPE || picked.size >= MAX_EVIDENCE_GROUPS) break;
      if (g.sourceType !== type) continue;
      picked.add(g);
      taken += 1;
    }
  }
  for (const g of ranked) {
    if (picked.size >= MAX_EVIDENCE_GROUPS) break;
    picked.add(g);
  }
  return ranked.filter((g) => picked.has(g));
}

/**
 * Bound evidence for LLM context: top N groups (by best score), each with at
 * most M snippets, every hit stamped with its group's citation ref.
 * Input must be pre-sorted best-first.
 * @param {import('../../domain/ports/EvidenceSource').EvidenceHit[]} hits
 * @returns {import('../../domain/ports/EvidenceSource').EvidenceHit[]}
 */
function boundEvidence(hits) {
  if (!Array.isArray(hits) || hits.length === 0) return [];

  const groups = new Map();
  for (const h of hits) {
    const key = groupKeyOf(h);
    if (!groups.has(key)) groups.set(key, { key, sourceType: sourceTypeOf(h), hits: [] });
    const group = groups.get(key);
    if (group.hits.length < MAX_SNIPPETS_PER_GROUP) group.hits.push(h);
  }

  let docSeq = 0;
  let semSeq = 0;
  return selectGroups([...groups.values()]).flatMap((group) => {
    const ref = group.sourceType === 'document'
      ? `D${(docSeq += 1)}`
      : group.sourceType === 'live'
        ? 'L1' // one group, 'live:current' — always the sole live citation in an answer
        : group.sourceType === 'semantic'
          ? `G${(semSeq += 1)}` // glossary/vocabulary — no meetingId to key off
          : `M${group.hits[0].meetingId}`;
    return group.hits.map((h) => ({
      ...h,
      ref,
      groupKey: group.key,
      sourceType: group.sourceType,
    }));
  });
}

/**
 * Map evidence hits to the protocol's source-card shape.
 * Optionally restrict to the refs the model actually cited (generate node).
 *
 * Meeting and document cards carry different fields rather than one padded
 * shape: a document has no meetingId, and emitting Number(null) === 0 would
 * render as "Meeting #0" in the UI.
 *
 * @param {import('../../domain/ports/EvidenceSource').EvidenceHit[]} hits
 * @param {string[]} [citedRefs]
 * @returns {Array<Object>}
 */
function toSources(hits, citedRefs = null) {
  if (!Array.isArray(hits)) return [];
  const cited = Array.isArray(citedRefs) && citedRefs.length
    ? new Set(citedRefs.map((r) => String(r).trim().toUpperCase()))
    : null;

  const seen = new Set();
  const out = [];
  for (const h of hits) {
    const ref = h.ref ? String(h.ref) : '';
    if (cited && !cited.has(ref.toUpperCase())) continue;

    const key = `${groupKeyOf(h)}:${h.sourceTable}:${h.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const sourceType = sourceTypeOf(h);
    const card = {
      ref,
      sourceType,
      snippet: h.text || '',
      sourceTable: h.sourceTable || '',
    };
    if (sourceType === 'document') {
      card.docId = h.docId || '';
      card.fileName = h.fileName || '';
      card.pageNumber = h.pageNumber ?? null;
    } else if (sourceType === 'live') {
      // No meetingId/date to attach — it hasn't been persisted as a
      // completed meeting record yet, unlike a 'meeting' hit.
      card.speaker = h.speaker || '';
    } else if (sourceType === 'semantic') {
      // No meetingId/date either, for the opposite reason: glossary/
      // vocabulary knowledge is cross-meeting by design (plan §06's "a term
      // shouldn't look project- or meeting-scoped from one stray mention") —
      // `h.text` already carries "term: definition", same as the snippet.
    } else {
      card.meetingId = Number(h.meetingId);
      card.date = h.meetingDate || '';
      card.speaker = h.speaker || '';
      card.meetingName = h.meetingName || '';
    }
    out.push(card);
  }
  return out;
}

module.exports = { boundEvidence, toSources, sourceTypeOf, groupKeyOf };
