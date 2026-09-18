/**
 * End-to-end test of the control path: raw CTL1 bytes -> deframer -> command
 * handler -> real SQLite. This is the round trip that makes ChunkGraph output
 * durable; before it existed, decisions and risks were emitted to the UI and
 * lost when the process exited.
 *
 * The byte fixtures here are mirrored by a Rust test in
 * src-tauri/src/adapters/control_channel.rs, so the two sides of the pipe
 * cannot drift apart silently.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { PcmDeframer } = require('../audio/pcm-deframer.js');
const { CommandHandler } = require('../control/command-handler.js');
const { DiarizationLayer } = require('../stt/diarization-layer.js');
const { startSession } = require('../db/index.js');

/** Frame a control command exactly as the Rust PipeControlChannel does. */
function ctlFrame(command) {
  const payload = Buffer.from(JSON.stringify(command), 'utf8');
  const header = Buffer.alloc(8);
  header.write('CTL1', 0, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function harness() {
  const session = startSession(':memory:', 'integration test');
  const diarization = new DiarizationLayer(session.speakers, {
    extractMFCC: () => null,
    cosineSimilarity: () => 0,
  });
  const handler = new CommandHandler({ artifacts: session.artifacts, diarization });
  const deframer = new PcmDeframer({ sendAudio: () => {} }, handler);
  return { session, deframer, diarization };
}

test('a persistChunk frame lands in the database as real rows', () => {
  const { session, deframer } = harness();

  deframer.append(
    ctlFrame({
      command: 'persistChunk',
      chunkRef: 'c0',
      chunk: {
        text: 'we agreed to ship on friday',
        speaker: 'Alice',
        significance: 'high',
        topic: 'release',
      },
      artifacts: {
        decisions: [{ text: 'ship on friday', confidence: 0.92 }],
        actionItems: [{ text: 'cut the branch', assignee: 'Bob', deadline: 'thursday' }],
        risks: [],
      },
      suggestedReply: 'Sounds good — who owns the branch cut?',
      glossary: { RC: 'release candidate' },
    })
  );

  const chunk = session.db.prepare('SELECT * FROM chunks WHERE meeting_id = ?').get(session.meetingId);
  assert.strictEqual(chunk.text, 'we agreed to ship on friday');
  assert.strictEqual(chunk.significance, 'high');
  assert.strictEqual(chunk.topic, 'release');

  const decision = session.db.prepare('SELECT * FROM decisions WHERE meeting_id = ?').get(session.meetingId);
  assert.strictEqual(decision.description, 'ship on friday');
  assert.strictEqual(decision.chunk_id, chunk.id);

  const action = session.db.prepare('SELECT * FROM action_items WHERE meeting_id = ?').get(session.meetingId);
  assert.strictEqual(action.assignee, 'Bob');

  const reply = session.db.prepare('SELECT * FROM suggested_replies WHERE meeting_id = ?').get(session.meetingId);
  assert.strictEqual(reply.text, 'Sounds good — who owns the branch cut?');

  const term = session.db.prepare('SELECT * FROM glossary_terms WHERE meeting_id = ?').get(session.meetingId);
  assert.strictEqual(term.definition, 'release candidate');

  const profile = session.db.prepare('SELECT * FROM speaker_profiles WHERE meeting_id = ?').get(session.meetingId);
  assert.strictEqual(profile.speaker, 'Alice');

  session.close('', 'ended');
});

test('the two waves of one chunk land on the same row', () => {
  const { session, deframer } = harness();

  deframer.append(
    ctlFrame({
      command: 'persistChunk',
      chunkRef: 'c1',
      chunk: { text: 'the timeline is looking tight', speaker: 'Alice' },
      artifacts: { decisions: [], actionItems: [], risks: [] },
    })
  );
  deframer.append(
    ctlFrame({
      command: 'persistArtifacts',
      chunkRef: 'c1',
      artifacts: {
        decisions: [],
        actionItems: [],
        risks: [{ text: 'QA has no time', category: 'TIMELINE', severity: 'high' }],
      },
    })
  );

  const chunk = session.db.prepare('SELECT * FROM chunks WHERE meeting_id = ?').get(session.meetingId);
  const risk = session.db.prepare('SELECT * FROM risks WHERE meeting_id = ?').get(session.meetingId);
  assert.strictEqual(risk.text, 'QA has no time');
  assert.strictEqual(risk.chunk_id, chunk.id, 'the late wave attached to the existing chunk');

  const chunkCount = session.db.prepare('SELECT COUNT(*) c FROM chunks').get().c;
  assert.strictEqual(chunkCount, 1, 'the second wave must not create another chunk');

  session.close('', 'ended');
});

test('a renameSpeaker frame persists and takes effect immediately', () => {
  const { session, deframer, diarization } = harness();

  assert.strictEqual(diarization.resolveLabel('Speaker A'), 'Speaker A');
  deframer.append(
    ctlFrame({ command: 'renameSpeaker', sttLabel: 'Speaker A', displayName: 'Alice' })
  );

  assert.strictEqual(diarization.resolveLabel('Speaker A'), 'Alice', 'live session state updated');
  assert.strictEqual(
    session.speakers.getSpeakerName('Speaker A'),
    'Alice',
    'and persisted for the next session'
  );

  session.close('', 'ended');
});

test('audio and control frames interleaved in one write both arrive', () => {
  const { session } = harness();
  const audio = [];
  const diar = new DiarizationLayer(session.speakers, {
    extractMFCC: () => null, cosineSimilarity: () => 0,
  });
  const handler = new CommandHandler({ artifacts: session.artifacts, diarization: diar });
  const deframer = new PcmDeframer({ sendAudio: (p) => audio.push(p) }, handler);

  const pcm = Buffer.alloc(8);
  pcm.write('PCM1', 0, 'ascii');
  pcm.writeUInt32LE(0, 4);

  deframer.append(
    Buffer.concat([
      pcm,
      ctlFrame({ command: 'renameSpeaker', sttLabel: 'Speaker B', displayName: 'Bob' }),
      pcm,
    ])
  );

  assert.strictEqual(audio.length, 2, 'audio unaffected by the control frame between it');
  assert.strictEqual(diar.resolveLabel('Speaker B'), 'Bob');
  session.close('', 'ended');
});

test('the exact byte layout the Rust side writes is accepted', () => {
  // Mirrored by control_channel.rs::tests::frame_layout_is_stable. If either
  // side changes the header, one of the two fails.
  const { session, deframer, diarization } = harness();

  // Key order matches serde_json's alphabetical output on the Rust side.
  const payload = Buffer.from('{"command":"renameSpeaker","displayName":"N","sttLabel":"S"}', 'utf8');
  const bytes = Buffer.concat([
    Buffer.from([0x43, 0x54, 0x4c, 0x31]),               // "CTL1"
    Buffer.from([payload.length, 0x00, 0x00, 0x00]),      // u32 LE length
    payload,
  ]);

  assert.strictEqual(payload.length, 60, 'fixture length pinned on both sides');
  deframer.append(bytes);
  assert.strictEqual(diarization.resolveLabel('S'), 'N');
  session.close('', 'ended');
});
