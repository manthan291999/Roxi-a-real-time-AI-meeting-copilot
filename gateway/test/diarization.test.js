/**
 * Diarization, the transcript pipeline, and the control handler.
 *
 * The diarization tests pin the behaviour that was previously dead: audio never
 * reached the layer, so embeddings were never built and cross-session voice
 * matching never ran.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { DiarizationLayer } = require('../stt/diarization-layer.js');
const { TranscriptPipeline } = require('../stt/transcript-pipeline.js');
const { TranscriptSanitizer } = require('../stt/transcript-sanitizer.js');
const { CommandHandler } = require('../control/command-handler.js');

/** In-memory stand-in for SpeakerRepository — the 5 methods it actually needs. */
function fakeSpeakerRepo(seed = {}) {
  const names = new Map(Object.entries(seed.names || {}));
  const embeddings = [...(seed.embeddings || [])];
  return {
    names,
    embeddings,
    saveSpeakerName: (l, n) => names.set(l, n),
    getSpeakerName: (l) => names.get(l) || null,
    saveSpeakerEmbedding: (l, n, v) =>
      embeddings.push({ stt_label: l, display_name: n, embedding_json: JSON.stringify(v) }),
    getAllSpeakerEmbeddings: () => embeddings,
    renameSpeakerEmbeddings: (l, n) => {
      for (const e of embeddings) if (e.stt_label === l) e.display_name = n;
    },
  };
}

/** Deterministic MFCC stand-in: the embedding is the buffer's first byte. */
const fakeMfcc = {
  extractMFCC: (buf) => (buf.length ? new Float32Array([buf[0], 1, 0]) : null),
  cosineSimilarity: (a, b) => (a[0] === b[0] ? 1 : 0),
};

const chunks = (byte, n) => Array.from({ length: n }, () => Buffer.from([byte, 0]));

test('resolveLabel falls back to the raw STT label', () => {
  const d = new DiarizationLayer(fakeSpeakerRepo(), fakeMfcc);
  assert.strictEqual(d.resolveLabel('Speaker A'), 'Speaker A');
  assert.strictEqual(d.resolveLabel(''), 'Speaker');
});

test('resolveLabel prefers a persisted name', () => {
  const d = new DiarizationLayer(fakeSpeakerRepo({ names: { 'Speaker A': 'Alice' } }), fakeMfcc);
  assert.strictEqual(d.resolveLabel('Speaker A'), 'Alice');
});

test('attributeTurn builds and persists an embedding from buffered audio', () => {
  // Previously impossible: pushAudio() required a speaker label the caller could
  // not know, so it was never called and the ring was always empty.
  const repo = fakeSpeakerRepo();
  const d = new DiarizationLayer(repo, fakeMfcc);

  for (const c of chunks(7, 6)) d.pushAudio(c);
  const embedding = d.attributeTurn('Speaker A');

  assert.ok(embedding, 'an embedding is produced');
  assert.strictEqual(repo.embeddings.length, 1, 'and persisted');
  assert.strictEqual(repo.embeddings[0].stt_label, 'Speaker A');
});

test('attributeTurn ignores a turn with too little audio', () => {
  const repo = fakeSpeakerRepo();
  const d = new DiarizationLayer(repo, fakeMfcc);
  d.pushAudio(Buffer.from([1, 0])); // one chunk, below the minimum
  assert.strictEqual(d.attributeTurn('Speaker A'), null);
  assert.strictEqual(repo.embeddings.length, 0);
});

test('audio is consumed per turn, not shared between speakers', () => {
  const repo = fakeSpeakerRepo();
  const d = new DiarizationLayer(repo, fakeMfcc);

  for (const c of chunks(7, 6)) d.pushAudio(c);
  d.attributeTurn('Speaker A');
  assert.strictEqual(d.pendingAudio.length, 0, 'buffer drains on attribution');

  for (const c of chunks(9, 6)) d.pushAudio(c);
  d.attributeTurn('Speaker B');

  assert.strictEqual(repo.embeddings.length, 2);
  assert.notDeepStrictEqual(
    JSON.parse(repo.embeddings[0].embedding_json),
    JSON.parse(repo.embeddings[1].embedding_json),
    'each speaker gets their own voice, not a blend'
  );
});

test('a returning voice is matched to its known name across sessions', () => {
  // The point of the whole feature, and previously unreachable code.
  const repo = fakeSpeakerRepo({
    embeddings: [
      { stt_label: 'Speaker C', display_name: 'Alice', embedding_json: JSON.stringify([7, 1, 0]) },
    ],
  });
  const d = new DiarizationLayer(repo, fakeMfcc);

  assert.strictEqual(d.resolveLabel('Speaker A'), 'Speaker A', 'unknown at first');
  for (const c of chunks(7, 6)) d.pushAudio(c); // same voice as the stored one
  d.attributeTurn('Speaker A');

  assert.strictEqual(d.resolveLabel('Speaker A'), 'Alice', 'matched by voice');
});

test('unnamed stored voices are not used as match candidates', () => {
  const repo = fakeSpeakerRepo({
    embeddings: [
      // display_name === stt_label: a bare label carries no information.
      { stt_label: 'Speaker C', display_name: 'Speaker C', embedding_json: JSON.stringify([7, 1, 0]) },
    ],
  });
  const d = new DiarizationLayer(repo, fakeMfcc);
  for (const c of chunks(7, 6)) d.pushAudio(c);
  d.attributeTurn('Speaker A');
  assert.strictEqual(d.resolveLabel('Speaker A'), 'Speaker A');
});

test('an explicit rename outranks a later voice match', () => {
  const repo = fakeSpeakerRepo({
    embeddings: [
      { stt_label: 'Speaker C', display_name: 'Alice', embedding_json: JSON.stringify([7, 1, 0]) },
    ],
  });
  const d = new DiarizationLayer(repo, fakeMfcc);

  assert.strictEqual(d.rename('Speaker A', 'Bob'), true);
  for (const c of chunks(7, 6)) d.pushAudio(c);
  d.attributeTurn('Speaker A');

  assert.strictEqual(d.resolveLabel('Speaker A'), 'Bob');
  assert.strictEqual(repo.names.get('Speaker A'), 'Bob', 'persisted for next session');
});

test('rename rejects empty input', () => {
  const d = new DiarizationLayer(fakeSpeakerRepo(), fakeMfcc);
  assert.strictEqual(d.rename('Speaker A', '   '), false);
  assert.strictEqual(d.rename('', 'Alice'), false);
});

test('corrupt stored embeddings are skipped, not fatal', () => {
  const repo = fakeSpeakerRepo({
    embeddings: [
      { stt_label: 'X', display_name: 'Broken', embedding_json: 'not json' },
      { stt_label: 'Y', display_name: 'Alice', embedding_json: JSON.stringify([7, 1, 0]) },
    ],
  });
  const d = new DiarizationLayer(repo, fakeMfcc);
  for (const c of chunks(7, 6)) d.pushAudio(c);
  d.attributeTurn('Speaker A');
  assert.strictEqual(d.resolveLabel('Speaker A'), 'Alice');
});

// --- Pipeline ------------------------------------------------------------------

function pipelineHarness() {
  const emitted = [];
  const saved = [];
  const d = new DiarizationLayer(fakeSpeakerRepo(), fakeMfcc);
  const pipeline = new TranscriptPipeline({
    diarization: d,
    sanitizer: new TranscriptSanitizer(),
    transcripts: { save: (speaker, text) => saved.push({ speaker, text }) },
    protocol: {
      emitPartial: (text, speaker) => emitted.push({ kind: 'partial', text, speaker }),
      emitFinal: (text, speaker) => emitted.push({ kind: 'final', text, speaker }),
    },
  });
  return { pipeline, emitted, saved, diarization: d };
}

test('a good final turn is emitted and stored', () => {
  const { pipeline, emitted, saved } = pipelineHarness();
  pipeline.onFinal({ text: 'we should ship on friday', speaker: 'Speaker A', confidence: 0.9 });
  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].kind, 'final');
  assert.deepStrictEqual(saved, [{ speaker: 'Speaker A', text: 'we should ship on friday' }]);
});

test('a low-confidence turn is dropped but its audio is still attributed', () => {
  const { pipeline, emitted, saved, diarization } = pipelineHarness();
  for (const c of chunks(7, 6)) diarization.pushAudio(c);

  pipeline.onFinal({ text: 'mumbled words here', speaker: 'Speaker A', confidence: 0.1 });

  assert.strictEqual(emitted.length, 0, 'not emitted');
  assert.strictEqual(saved.length, 0, 'not stored');
  assert.strictEqual(diarization.pendingAudio.length, 0, 'audio still consumed for the voice');
});

test('blocklisted hallucinations are dropped', () => {
  const { pipeline, emitted } = pipelineHarness();
  pipeline.onFinal({ text: 'thanks for watching', speaker: 'Speaker A', confidence: 0.99 });
  assert.strictEqual(emitted.length, 0);
});

// --- Control handler ------------------------------------------------------------

test('persistChunk writes through to the meeting repository', () => {
  const calls = [];
  const handler = new CommandHandler({
    meetings: {
      saveAnalyzedChunk: (chunk, artifacts) => { calls.push({ chunk, artifacts }); return 1; },
      saveTechnicalAnalysis: () => {},
      saveSuggestedReply: () => {},
      upsertGlossary: () => {},
      upsertSpeakerProfile: () => {},
    },
    diarization: { rename: () => true },
  });

  handler.handle({
    command: 'persistChunk',
    chunk: { text: 'we will ship on friday', speaker: 'Alice', significance: 'high', topic: 'release' },
    artifacts: { decisions: [{ text: 'ship friday', confidence: 0.9 }], actionItems: [], risks: [] },
  });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].chunk.speaker, 'Alice');
  assert.strictEqual(calls[0].artifacts.decisions[0].text, 'ship friday');
});

test('chunk sequence numbers increment across calls', () => {
  const seqs = [];
  const handler = new CommandHandler({
    meetings: {
      saveAnalyzedChunk: (chunk) => { seqs.push(chunk.seq); return 1; },
      saveTechnicalAnalysis: () => {}, saveSuggestedReply: () => {},
      upsertGlossary: () => {}, upsertSpeakerProfile: () => {},
    },
    diarization: { rename: () => true },
  });
  for (let i = 0; i < 3; i++) {
    handler.handle({ command: 'persistChunk', chunk: { text: 'some spoken words', speaker: 'A' } });
  }
  assert.deepStrictEqual(seqs, [0, 1, 2]);
});

test('an invalid chunk envelope is rejected, not written', () => {
  let wrote = false;
  const handler = new CommandHandler({
    meetings: { saveAnalyzedChunk: () => { wrote = true; return 1; } },
    diarization: { rename: () => true },
  });
  handler.handle({ command: 'persistChunk', chunk: { text: '   ' } });
  assert.strictEqual(wrote, false);
});

test('renameSpeaker delegates to the diarization layer', () => {
  const renames = [];
  const handler = new CommandHandler({
    meetings: {},
    diarization: { rename: (l, n) => { renames.push([l, n]); return true; } },
  });
  handler.handle({ command: 'renameSpeaker', sttLabel: 'Speaker A', displayName: 'Alice' });
  assert.deepStrictEqual(renames, [['Speaker A', 'Alice']]);
});

test('unknown and malformed commands are ignored safely', () => {
  const handler = new CommandHandler({ meetings: {}, diarization: {} });
  assert.doesNotThrow(() => {
    handler.handle({ command: 'nonsense' });
    handler.handle({});
    handler.handle(null);
  });
});

test('the detached lane attaches artifacts to the chunk the first wave created', () => {
  // The host pipeline has two lanes, so a chunk's artifacts arrive in two waves.
  const created = [];
  const attached = [];
  const handler = new CommandHandler({
    meetings: {
      saveAnalyzedChunk: (chunk) => { created.push(chunk); return 42; },
      saveArtifacts: (chunkId, artifacts) => attached.push({ chunkId, artifacts }),
      saveTechnicalAnalysis: () => {}, saveSuggestedReply: () => {},
      upsertGlossary: () => {}, upsertSpeakerProfile: () => {},
    },
    diarization: { rename: () => true },
  });

  handler.handle({
    command: 'persistChunk',
    chunkRef: 'c0',
    chunk: { text: 'we will ship on friday', speaker: 'Alice' },
    artifacts: { decisions: [], actionItems: [], risks: [] },
  });
  handler.handle({
    command: 'persistArtifacts',
    chunkRef: 'c0',
    artifacts: { risks: [{ text: 'QA has no time', category: 'TIMELINE', severity: 'high' }] },
  });

  assert.strictEqual(created.length, 1);
  assert.strictEqual(attached.length, 1);
  assert.strictEqual(attached[0].chunkId, 42, 'attached to the row the first wave created');
  assert.strictEqual(attached[0].artifacts.risks[0].severity, 'high');
});

test('artifacts for an unknown chunk are dropped, not mis-attached', () => {
  let attached = 0;
  const handler = new CommandHandler({
    meetings: { saveArtifacts: () => { attached++; } },
    diarization: { rename: () => true },
  });
  handler.handle({ command: 'persistArtifacts', chunkRef: 'never-seen', artifacts: { risks: [] } });
  assert.strictEqual(attached, 0);
});

test('the chunkRef map is bounded', () => {
  const handler = new CommandHandler({
    meetings: {
      saveAnalyzedChunk: () => 1, saveArtifacts: () => {},
      saveTechnicalAnalysis: () => {}, saveSuggestedReply: () => {},
      upsertGlossary: () => {}, upsertSpeakerProfile: () => {},
    },
    diarization: { rename: () => true },
  });
  for (let i = 0; i < 500; i++) {
    handler.handle({
      command: 'persistChunk',
      chunkRef: `c${i}`,
      chunk: { text: 'a line of spoken words', speaker: 'Alice' },
    });
  }
  assert.ok(handler.chunkIds.size <= 200, `map grew to ${handler.chunkIds.size}`);
});

test('artifacts are validated before being attached', () => {
  const attached = [];
  const handler = new CommandHandler({
    meetings: {
      saveAnalyzedChunk: () => 42, saveArtifacts: (id, a) => attached.push(a),
      saveTechnicalAnalysis: () => {}, saveSuggestedReply: () => {},
      upsertGlossary: () => {}, upsertSpeakerProfile: () => {},
    },
    diarization: { rename: () => true },
  });
  handler.handle({
    command: 'persistChunk', chunkRef: 'c0',
    chunk: { text: 'a line of spoken words', speaker: 'Alice' },
  });
  handler.handle({
    command: 'persistArtifacts', chunkRef: 'c0',
    artifacts: {
      risks: [
        { text: '   ', category: 'TIMELINE', severity: 'high' },   // empty -> dropped
        { text: 'real risk', category: 'NOT_A_CATEGORY', severity: 'nope' }, // bad enums -> nulled
      ],
    },
  });
  assert.strictEqual(attached[0].risks.length, 1, 'empty text dropped');
  assert.strictEqual(attached[0].risks[0].category, null, 'unknown category rejected');
  assert.strictEqual(attached[0].risks[0].severity, null, 'unknown severity rejected');
});
