/**
 * Unit tests: evidence shaping — meeting bounding + source mapping.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { boundEvidence, toSources } = require('../src/application/graph/evidence');
const { MAX_EVIDENCE_MEETINGS, MAX_SNIPPETS_PER_MEETING } = require('../src/application/graph/constants');

function hit(meetingId, sourceId, text = 't') {
  return { meetingId, sourceId, sourceTable: 'transcripts', speaker: 'A', text, meetingDate: 'd', score: 1 };
}

test('boundEvidence caps meetings and snippets per meeting', () => {
  const hits = [];
  for (let m = 1; m <= MAX_EVIDENCE_MEETINGS + 3; m++) {
    for (let s = 0; s < MAX_SNIPPETS_PER_MEETING + 4; s++) hits.push(hit(m, s));
  }
  const bounded = boundEvidence(hits);
  const meetings = new Set(bounded.map((h) => h.meetingId));
  assert.strictEqual(meetings.size, MAX_EVIDENCE_MEETINGS);
  for (const m of meetings) {
    const count = bounded.filter((h) => h.meetingId === m).length;
    assert.ok(count <= MAX_SNIPPETS_PER_MEETING);
  }
});

test('boundEvidence keeps first (best-ranked) meetings', () => {
  const hits = [hit(9, 1), hit(8, 1), hit(7, 1)];
  const bounded = boundEvidence(hits);
  assert.deepStrictEqual(bounded.map((h) => h.meetingId), [9, 8, 7].slice(0, MAX_EVIDENCE_MEETINGS));
});

test('boundEvidence handles empty input', () => {
  assert.deepStrictEqual(boundEvidence([]), []);
  assert.deepStrictEqual(boundEvidence(null), []);
});

test('toSources maps hits to protocol shape and dedupes', () => {
  const hits = [hit(3, 1, 'hello'), hit(3, 1, 'hello'), hit(5, 2, 'world')];
  const sources = toSources(hits);
  assert.strictEqual(sources.length, 2);
  assert.deepStrictEqual(Object.keys(sources[0]).sort(), ['date', 'meetingId', 'snippet', 'sourceTable', 'speaker']);
  assert.strictEqual(sources[0].meetingId, 3);
  assert.strictEqual(sources[0].snippet, 'hello');
});

test('toSources filters by cited meeting ids', () => {
  const hits = [hit(3, 1), hit(5, 2), hit(7, 3)];
  const sources = toSources(hits, [5, 7]);
  assert.deepStrictEqual(sources.map((s) => s.meetingId), [5, 7]);
});
