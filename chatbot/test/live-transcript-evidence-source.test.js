/**
 * Unit tests: LiveTranscriptEvidenceSource — no DB, no network, pure buffer
 * scoring. Matches the EvidenceSource contract other sources use (see
 * evidence.test.js's liveHit fixture for the hit shape this must produce).
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { LiveTranscriptEvidenceSource } = require('../src/application/retrieval/LiveTranscriptEvidenceSource');

test('empty or missing liveContext returns no hits', async () => {
  const source = new LiveTranscriptEvidenceSource();
  assert.deepStrictEqual(await source.search({ question: 'what did we decide' }), []);
  assert.deepStrictEqual(
    await source.search({ question: 'what did we decide', liveContext: '   ' }),
    [],
  );
});

test('every hit is stamped for the live corpus, distinct from meetings/documents', async () => {
  const source = new LiveTranscriptEvidenceSource();
  const hits = await source.search({
    question: 'webhook',
    liveContext: 'Speaker A: The payment webhook keeps failing\nSpeaker B: Let us look at retries',
  });
  assert.ok(hits.length > 0);
  for (const h of hits) {
    assert.strictEqual(h.sourceType, 'live');
    assert.strictEqual(h.groupKey, 'live:current');
    assert.strictEqual(h.sourceTable, 'live_transcript');
    assert.strictEqual(h.meetingId, null);
  }
});

test('lines matching the question rank above unrelated lines', async () => {
  const source = new LiveTranscriptEvidenceSource();
  const hits = await source.search({
    question: 'webhook retries',
    liveContext: [
      'Speaker A: Lunch is at noon',
      'Speaker B: The webhook keeps failing on retries',
      'Speaker A: Someone booked the conference room',
    ].join('\n'),
  });
  assert.ok(hits[0].text.includes('webhook'));
});

test('speaker and text are split on the first colon', async () => {
  const source = new LiveTranscriptEvidenceSource();
  const [hit] = await source.search({
    question: 'deploy',
    liveContext: 'Speaker A: We should deploy on Friday',
  });
  assert.strictEqual(hit.speaker, 'Speaker A');
  assert.strictEqual(hit.text, 'We should deploy on Friday');
});

test('a line with no speaker prefix is kept as plain text', async () => {
  const source = new LiveTranscriptEvidenceSource();
  const [hit] = await source.search({
    question: 'deploy',
    liveContext: 'we should deploy on Friday',
  });
  assert.strictEqual(hit.speaker, '');
  assert.strictEqual(hit.text, 'we should deploy on Friday');
});

test('no keyword overlap falls back to the most recent lines, not the first ones', async () => {
  const source = new LiveTranscriptEvidenceSource();
  const hits = await source.search({
    question: 'hello there',
    liveContext: 'Speaker A: first thing said\nSpeaker A: second thing said\nSpeaker A: third thing said',
    limit: 1,
  });
  assert.strictEqual(hits[0].text, 'third thing said');
});

test('respects the limit even with many lines', async () => {
  const source = new LiveTranscriptEvidenceSource();
  const liveContext = Array.from({ length: 50 }, (_, i) => `Speaker A: line ${i}`).join('\n');
  const hits = await source.search({ question: 'line', liveContext, limit: 5 });
  assert.strictEqual(hits.length, 5);
});
