/**
 * Unit tests: evidence shaping — group bounding, citation refs, source mapping.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { boundEvidence, toSources } = require('../src/application/graph/evidence');
const {
  MAX_EVIDENCE_GROUPS,
  MAX_SNIPPETS_PER_GROUP,
  MIN_GROUPS_PER_SOURCE_TYPE,
} = require('../src/application/graph/constants');

function hit(meetingId, sourceId, text = 't') {
  return {
    sourceType: 'meeting',
    groupKey: `meeting:${meetingId}`,
    meetingId,
    sourceId,
    sourceTable: 'transcripts',
    speaker: 'A',
    text,
    meetingDate: 'd',
    score: 1,
  };
}

function docHit(docId, chunkId, text = 'doc text', pageNumber = 1) {
  return {
    sourceType: 'document',
    groupKey: `doc:${docId}`,
    meetingId: null,
    docId,
    fileName: `${docId}.pdf`,
    pageNumber,
    sourceId: chunkId,
    sourceTable: 'documents',
    text,
    score: 0.9,
  };
}

function liveHit(sourceId, text = 'we just said this', speaker = 'Speaker A') {
  return {
    sourceType: 'live',
    groupKey: 'live:current',
    sourceTable: 'live_transcript',
    sourceId,
    meetingId: null,
    meetingDate: '',
    speaker,
    text,
    score: 1,
  };
}

function semanticHit(term, sourceId = term) {
  // Mirrors SemanticMemoryEvidenceSource.js's hit shape exactly.
  return {
    sourceType: 'semantic',
    groupKey: `glossary:${term}`,
    sourceTable: 'glossary_term',
    sourceId,
    meetingId: null,
    meetingDate: '',
    speaker: '',
    text: `${term}: a definition`,
    score: 0.95,
  };
}

test('boundEvidence caps groups and snippets per group', () => {
  const hits = [];
  for (let m = 1; m <= MAX_EVIDENCE_GROUPS + 3; m++) {
    for (let s = 0; s < MAX_SNIPPETS_PER_GROUP + 4; s++) hits.push(hit(m, s));
  }
  const bounded = boundEvidence(hits);
  const meetings = new Set(bounded.map((h) => h.meetingId));
  assert.strictEqual(meetings.size, MAX_EVIDENCE_GROUPS);
  for (const m of meetings) {
    const count = bounded.filter((h) => h.meetingId === m).length;
    assert.ok(count <= MAX_SNIPPETS_PER_GROUP);
  }
});

test('boundEvidence keeps first (best-ranked) groups', () => {
  const hits = [hit(9, 1), hit(8, 1), hit(7, 1)];
  const bounded = boundEvidence(hits);
  assert.deepStrictEqual(bounded.map((h) => h.meetingId), [9, 8, 7].slice(0, MAX_EVIDENCE_GROUPS));
});

test('boundEvidence handles empty input', () => {
  assert.deepStrictEqual(boundEvidence([]), []);
  assert.deepStrictEqual(boundEvidence(null), []);
});

test('meeting refs stay M<meetingId> — the shipped citation vocabulary', () => {
  const bounded = boundEvidence([hit(3, 1), hit(3, 2), hit(5, 1)]);
  assert.strictEqual(bounded.find((h) => h.meetingId === 3).ref, 'M3');
  assert.strictEqual(bounded.find((h) => h.meetingId === 5).ref, 'M5');
});

test('every hit in a group carries the same ref', () => {
  const bounded = boundEvidence([docHit('abc', 'c1'), docHit('abc', 'c2'), docHit('xyz', 'c3')]);
  const abc = bounded.filter((h) => h.docId === 'abc');
  assert.strictEqual(abc.length, 2);
  assert.strictEqual(abc[0].ref, abc[1].ref);
  assert.notStrictEqual(abc[0].ref, bounded.find((h) => h.docId === 'xyz').ref);
});

test('document refs are D1..Dn in selection order, not docId-derived', () => {
  const bounded = boundEvidence([docHit('zzz', 'c1'), docHit('aaa', 'c2')]);
  assert.deepStrictEqual([...new Set(bounded.map((h) => h.ref))], ['D1', 'D2']);
});

test('refs are unique per group across mixed sources', () => {
  const bounded = boundEvidence([hit(3, 1), docHit('abc', 'c1'), hit(4, 1), docHit('xyz', 'c2')]);
  const refs = [...new Set(bounded.map((h) => h.ref))];
  assert.deepStrictEqual(refs, ['M3', 'D1', 'M4', 'D2']);
});

test('boundEvidence derives grouping for hits with no groupKey stamped', () => {
  const raw = { meetingId: 7, sourceId: 1, sourceTable: 'transcripts', text: 't' };
  const bounded = boundEvidence([raw]);
  assert.strictEqual(bounded[0].groupKey, 'meeting:7');
  assert.strictEqual(bounded[0].sourceType, 'meeting');
  assert.strictEqual(bounded[0].ref, 'M7');
});

test('a document flood cannot crowd every meeting out of the evidence', () => {
  // Documents win every rank; without the quota the meeting is never seen.
  const hits = [];
  for (let d = 0; d < MAX_EVIDENCE_GROUPS + 2; d++) hits.push(docHit(`doc${d}`, `c${d}`));
  hits.push(hit(3, 1));
  const bounded = boundEvidence(hits);

  const groups = new Set(bounded.map((h) => h.groupKey));
  assert.strictEqual(groups.size, MAX_EVIDENCE_GROUPS);
  const meetingGroups = new Set(bounded.filter((h) => h.sourceType === 'meeting').map((h) => h.groupKey));
  assert.ok(meetingGroups.size >= MIN_GROUPS_PER_SOURCE_TYPE);
  assert.ok(bounded.some((h) => h.meetingId === 3));
});

test('the quota reserves in both directions', () => {
  const hits = [];
  for (let m = 1; m <= MAX_EVIDENCE_GROUPS + 2; m++) hits.push(hit(m, 1));
  hits.push(docHit('abc', 'c1'));
  const bounded = boundEvidence(hits);
  const docGroups = new Set(bounded.filter((h) => h.sourceType === 'document').map((h) => h.groupKey));
  assert.ok(docGroups.size >= MIN_GROUPS_PER_SOURCE_TYPE);
});

test('the quota does not disturb rank order of what it selects', () => {
  const hits = [];
  for (let d = 0; d < MAX_EVIDENCE_GROUPS + 1; d++) hits.push(docHit(`doc${d}`, `c${d}`));
  hits.push(hit(3, 1));
  const bounded = boundEvidence(hits);
  const order = [...new Set(bounded.map((h) => h.groupKey))];
  // The reserved meeting ranked last, so it must still appear last.
  assert.strictEqual(order[order.length - 1], 'meeting:3');
  assert.ok(order.slice(0, -1).every((k) => k.startsWith('doc:')));
});

test('the quota is inert when only one corpus contributed', () => {
  const hits = [];
  for (let m = 1; m <= MAX_EVIDENCE_GROUPS + 3; m++) hits.push(hit(m, 1));
  const bounded = boundEvidence(hits);
  assert.deepStrictEqual(bounded.map((h) => h.meetingId), [1, 2, 3, 4].slice(0, MAX_EVIDENCE_GROUPS));
});

test('toSources maps meeting hits to protocol shape and dedupes', () => {
  const hits = boundEvidence([hit(3, 1, 'hello'), hit(3, 1, 'hello'), hit(5, 2, 'world')]);
  const sources = toSources(hits);
  assert.strictEqual(sources.length, 2);
  assert.deepStrictEqual(
    Object.keys(sources[0]).sort(),
    ['date', 'meetingId', 'meetingName', 'ref', 'snippet', 'sourceTable', 'sourceType', 'speaker'],
  );
  assert.strictEqual(sources[0].meetingId, 3);
  assert.strictEqual(sources[0].ref, 'M3');
  assert.strictEqual(sources[0].sourceType, 'meeting');
  assert.strictEqual(sources[0].snippet, 'hello');
});

test('toSources carries the meeting name through to the source card', () => {
  const named = { ...hit(64, 1, 'deep learning'), meetingName: 'Deep Learning Fundamentals Review' };
  const [card] = toSources(boundEvidence([named]));
  assert.strictEqual(card.meetingName, 'Deep Learning Fundamentals Review');
});

test('toSources falls back to an empty meeting name for legacy (unnamed) meetings', () => {
  const [card] = toSources(boundEvidence([hit(64, 1, 'no name on this one')]));
  assert.strictEqual(card.meetingName, '');
});

test('toSources emits document fields and no meetingId for document hits', () => {
  const hits = boundEvidence([docHit('abc', 'c1', 'spec text', 4)]);
  const [card] = toSources(hits);
  assert.deepStrictEqual(
    Object.keys(card).sort(),
    ['docId', 'fileName', 'pageNumber', 'ref', 'snippet', 'sourceTable', 'sourceType'],
  );
  // Number(null) === 0 would render as "Meeting #0" in the UI.
  assert.ok(!('meetingId' in card));
  assert.strictEqual(card.docId, 'abc');
  assert.strictEqual(card.fileName, 'abc.pdf');
  assert.strictEqual(card.pageNumber, 4);
  assert.strictEqual(card.ref, 'D1');
});

test('toSources filters by cited refs across both source types', () => {
  const hits = boundEvidence([hit(3, 1), docHit('abc', 'c1'), hit(7, 2)]);
  const sources = toSources(hits, ['M7', 'D1']);
  assert.deepStrictEqual(sources.map((s) => s.ref), ['D1', 'M7']);
});

test('toSources ref matching is case- and whitespace-tolerant', () => {
  const hits = boundEvidence([hit(3, 1), hit(7, 2)]);
  assert.deepStrictEqual(toSources(hits, [' m3 ']).map((s) => s.ref), ['M3']);
});

test('toSources with an unmatched ref returns nothing rather than everything', () => {
  const hits = boundEvidence([hit(3, 1)]);
  assert.deepStrictEqual(toSources(hits, ['M99']), []);
});

test('toSources dedupes two documents that share a chunk index', () => {
  const hits = boundEvidence([docHit('abc', 'c1'), docHit('xyz', 'c1')]);
  assert.strictEqual(toSources(hits).length, 2);
});

test('live hits get ref L1, not a fabricated meeting ref', () => {
  const hits = boundEvidence([liveHit(0), liveHit(1)]);
  assert.ok(hits.every((h) => h.ref === 'L1'));
  assert.ok(hits.every((h) => h.sourceType === 'live'));
});

test('a live hit and a meeting hit never collide into the same group', () => {
  const hits = boundEvidence([liveHit(0), hit(3, 1)]);
  const groupKeys = new Set(hits.map((h) => h.groupKey));
  assert.strictEqual(groupKeys.size, 2);
  assert.ok(groupKeys.has('live:current'));
});

test('toSources emits speaker but no meetingId/date for live hits', () => {
  const hits = boundEvidence([liveHit(0, 'we should ship Friday', 'Speaker B')]);
  const [card] = toSources(hits);
  assert.deepStrictEqual(
    Object.keys(card).sort(),
    ['ref', 'snippet', 'sourceTable', 'sourceType', 'speaker'],
  );
  assert.ok(!('meetingId' in card));
  assert.ok(!('date' in card));
  assert.strictEqual(card.speaker, 'Speaker B');
  assert.strictEqual(card.ref, 'L1');
});

test('toSources filters cited refs across all three source types', () => {
  const hits = boundEvidence([hit(3, 1), docHit('abc', 'c1'), liveHit(0)]);
  const sources = toSources(hits, ['L1']);
  assert.deepStrictEqual(sources.map((s) => s.ref), ['L1']);
});

test('semantic (glossary) hits get ref G1, not a fabricated "Meeting #0"', () => {
  // Regression test: sourceTypeOf() used to have no 'semantic' branch, so a
  // glossary hit fell through to the 'meeting' default and was keyed off its
  // (always-null) meetingId — producing the literal ref string "Mnull" and,
  // downstream in toSources, `meetingId: Number(null) === 0`, which the UI
  // renders as "Meeting #0".
  const hits = boundEvidence([semanticHit('rrf'), semanticHit('smb')]);
  assert.deepStrictEqual(hits.map((h) => h.ref).sort(), ['G1', 'G2']);
  assert.ok(hits.every((h) => h.sourceType === 'semantic'));
  assert.ok(hits.every((h) => h.ref !== 'Mnull'));
});

test('a semantic hit and a meeting hit never collide into the same group', () => {
  const hits = boundEvidence([semanticHit('rrf'), hit(3, 1)]);
  const groupKeys = new Set(hits.map((h) => h.groupKey));
  assert.strictEqual(groupKeys.size, 2);
  assert.ok(groupKeys.has('glossary:rrf'));
});

test('toSources emits no meetingId/date for semantic hits — no "Meeting #0"', () => {
  const hits = boundEvidence([semanticHit('rrf')]);
  const [card] = toSources(hits);
  assert.deepStrictEqual(
    Object.keys(card).sort(),
    ['ref', 'snippet', 'sourceTable', 'sourceType'],
  );
  assert.ok(!('meetingId' in card));
  assert.ok(!('date' in card));
  assert.strictEqual(card.sourceType, 'semantic');
  assert.strictEqual(card.snippet, 'rrf: a definition');
  assert.strictEqual(card.ref, 'G1');
});

test('toSources filters cited refs across all four source types', () => {
  const hits = boundEvidence([hit(3, 1), docHit('abc', 'c1'), liveHit(0), semanticHit('rrf')]);
  const sources = toSources(hits, ['G1']);
  assert.deepStrictEqual(sources.map((s) => s.ref), ['G1']);
});
