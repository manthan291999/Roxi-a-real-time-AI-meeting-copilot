/**
 * Unit tests: pure chunk -> (embedded text, Qdrant payload) mapping. No DB,
 * no network — same style as rrf.test.js / evidence.test.js.
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  textToEmbed,
  toEpisodicPayload,
  MEETING_CONTEXT_MAX_CHARS,
} = require('../src/infrastructure/vectorstore/episodicPayload');

function chunk(overrides = {}) {
  return {
    id: 42,
    meetingId: 7,
    chunkSeq: 3,
    projectId: 1,
    displayId: 'ROXI-007',
    speaker: 'Speaker A',
    text: 'we decided to ship the fix on Friday',
    topic: 'release',
    significance: 'high',
    createdAt: '2026-08-20T10:00:00.000Z',
    meetingStartTime: '2026-08-20T09:55:00.000Z',
    meetingContext: 'Weekly release planning',
    linkedDecisionIds: [1],
    linkedRiskIds: [],
    linkedActionItemIds: [2, 3],
    ...overrides,
  };
}

test('textToEmbed', async (t) => {
  await t.test('prepends the meeting context ahead of the chunk text', () => {
    const text = textToEmbed(chunk());
    assert.strictEqual(text, 'Weekly release planning\n\nwe decided to ship the fix on Friday');
  });

  await t.test('no context: just the bare chunk text', () => {
    const text = textToEmbed(chunk({ meetingContext: null }));
    assert.strictEqual(text, 'we decided to ship the fix on Friday');
  });

  await t.test('blank context is treated the same as no context', () => {
    const text = textToEmbed(chunk({ meetingContext: '   ' }));
    assert.strictEqual(text, 'we decided to ship the fix on Friday');
  });

  await t.test('a context longer than the cap is truncated before it reaches the embedding', () => {
    const longContext = 'x'.repeat(MEETING_CONTEXT_MAX_CHARS + 50);
    const text = textToEmbed(chunk({ meetingContext: longContext }));
    assert.strictEqual(text.split('\n\n')[0].length, MEETING_CONTEXT_MAX_CHARS);
  });
});

test('toEpisodicPayload', async (t) => {
  const provenance = { embedModel: 'text-embedding-3-small', embedDims: 1536 };

  await t.test('maps every field the plan specifies', () => {
    const c = chunk();
    const embedded = textToEmbed(c);
    const payload = toEpisodicPayload(c, embedded, provenance);

    assert.strictEqual(payload.source_table, 'chunks');
    assert.strictEqual(payload.meeting_id, 7);
    assert.strictEqual(payload.project_id, 1);
    assert.strictEqual(payload.display_id, 'ROXI-007');
    assert.strictEqual(payload.chunk_seq, 3);
    assert.strictEqual(payload.speaker, 'Speaker A');
    assert.strictEqual(payload.topic, 'release');
    assert.strictEqual(payload.significance, 'high');
    assert.strictEqual(payload.importance, 1.0);
    assert.deepStrictEqual(payload.linked_decision_ids, [1]);
    assert.deepStrictEqual(payload.linked_risk_ids, []);
    assert.deepStrictEqual(payload.linked_action_item_ids, [2, 3]);
    assert.strictEqual(payload.meeting_context, 'Weekly release planning');
    assert.strictEqual(payload.meeting_start_time, '2026-08-20T09:55:00.000Z');
    // The chunk's own created_at ("since spoken"), not sync time.
    assert.strictEqual(payload.created_at, '2026-08-20T10:00:00.000Z');
    assert.strictEqual(payload.char_count, embedded.length);
    assert.strictEqual(payload.embed_model, 'text-embedding-3-small');
    assert.strictEqual(payload.embed_dims, 1536);
  });

  await t.test('missing significance defaults to medium, not low or a crash', () => {
    const payload = toEpisodicPayload(chunk({ significance: null }), 'x', provenance);
    assert.strictEqual(payload.significance, 'medium');
    assert.strictEqual(payload.importance, 0.6);
  });

  await t.test('an unrecognized significance value also falls back to medium', () => {
    const payload = toEpisodicPayload(chunk({ significance: 'urgent' }), 'x', provenance);
    assert.strictEqual(payload.significance, 'medium');
  });

  await t.test('no project scoping is represented as null, not zero or undefined', () => {
    const payload = toEpisodicPayload(chunk({ projectId: null }), 'x', provenance);
    assert.strictEqual(payload.project_id, null);
  });

  await t.test('no linked artifacts is an empty array, not null', () => {
    const payload = toEpisodicPayload(
      chunk({ linkedDecisionIds: [], linkedRiskIds: [], linkedActionItemIds: [] }),
      'x',
      provenance
    );
    assert.deepStrictEqual(payload.linked_decision_ids, []);
    assert.deepStrictEqual(payload.linked_risk_ids, []);
    assert.deepStrictEqual(payload.linked_action_item_ids, []);
  });
});
