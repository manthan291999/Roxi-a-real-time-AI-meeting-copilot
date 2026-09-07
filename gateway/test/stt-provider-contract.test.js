/**
 * Conformance tests for ISttProvider, run against every provider.
 *
 * These exist because the interface was previously a JSDoc comment over an
 * empty export: nothing enforced it, and the two providers silently diverged on
 * whether a `final` event carries `confidence`. The consequence was that on
 * failover to Speechmatics every turn bypassed the low-confidence filter.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { checkSttProvider, checkFinalEvent } = require('../interfaces/ISttProvider.js');
const { AssemblyAIProvider } = require('../providers/assemblyai.js');
const { SpeechmaticsProvider } = require('../providers/speechmatics.js');

const PROVIDERS = [
  ['assemblyai', () => new AssemblyAIProvider('test-key')],
  ['speechmatics', () => new SpeechmaticsProvider('test-key')],
];

for (const [name, construct] of PROVIDERS) {
  test(`${name} satisfies the ISttProvider shape`, () => {
    const result = checkSttProvider(construct());
    assert.deepStrictEqual(result.problems, [], `${name}: ${result.problems.join('; ')}`);
  });
}

test('assemblyai emits a contract-valid final event', () => {
  const provider = new AssemblyAIProvider('test-key');
  const finals = [];
  provider.on('final', (e) => finals.push(e));

  provider.handleTurn({
    transcript: 'we should ship on friday',
    end_of_turn: true,
    speaker_label: 'A',
    start: 1,
    end: 2,
    words: [{ confidence: 0.9 }, { confidence: 0.7 }],
  });

  assert.strictEqual(finals.length, 1);
  const check = checkFinalEvent(finals[0]);
  assert.deepStrictEqual(check.problems, []);
  assert.ok(Math.abs(finals[0].confidence - 0.8) < 1e-9, 'confidence is the mean word confidence');
});

test('speechmatics emits a contract-valid final event with averaged confidence', () => {
  const provider = new SpeechmaticsProvider('test-key');
  const finals = [];
  provider.on('final', (e) => finals.push(e));

  provider.handleServerMessage({
    message: 'AddTranscript',
    metadata: { transcript: 'we should ship on friday', start_time: 1, end_time: 2 },
    results: [
      { type: 'word', alternatives: [{ speaker: 'S1', confidence: 0.6 }] },
      { type: 'word', alternatives: [{ speaker: 'S1', confidence: 0.8 }] },
    ],
  });

  assert.strictEqual(finals.length, 1);
  const check = checkFinalEvent(finals[0]);
  assert.deepStrictEqual(check.problems, [], `speechmatics: ${check.problems.join('; ')}`);
  assert.ok(Math.abs(finals[0].confidence - 0.7) < 1e-9);
  assert.strictEqual(finals[0].speaker, 'Speaker A', 'S1 maps to the shared label scheme');
});

test('both providers report low confidence rather than omitting it', () => {
  // The regression that motivated this file: a provider that omits confidence
  // makes every one of its turns unfilterable.
  const assembly = new AssemblyAIProvider('k');
  const speechmatics = new SpeechmaticsProvider('k');
  const seen = [];
  assembly.on('final', (e) => seen.push(e.confidence));
  speechmatics.on('final', (e) => seen.push(e.confidence));

  assembly.handleTurn({
    transcript: 'mumbled words here',
    end_of_turn: true,
    speaker_label: 'A',
    words: [{ confidence: 0.1 }],
  });
  speechmatics.handleServerMessage({
    message: 'AddTranscript',
    metadata: { transcript: 'mumbled words here' },
    results: [{ type: 'word', alternatives: [{ speaker: 'S1', confidence: 0.1 }] }],
  });

  assert.deepStrictEqual(seen, [0.1, 0.1]);
  for (const c of seen) assert.ok(c < 0.4, 'both are below the sanitizer threshold');
});
