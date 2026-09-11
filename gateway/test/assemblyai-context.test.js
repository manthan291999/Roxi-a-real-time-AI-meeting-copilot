/**
 * The meeting context -> AssemblyAI recognition-hint conversion.
 *
 * The intake modal's context is the only description of the meeting this
 * process has, and Universal-3.5-Pro takes it two ways: `prompt` for the
 * general domain and `keyterms_prompt` for the specific names it should expect
 * to hear. Both are lossy, best-effort transforms of free text, so the value is
 * in pinning down what they do and do not pick up.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { extractKeyterms, buildPrompt, AssemblyAIProvider } = require('../providers/assemblyai.js');

// --- extractKeyterms -----------------------------------------------------------

test('proper nouns and jargon are collected', () => {
  const terms = extractKeyterms(
    'Sync with Jane Okafor about Project Aurora and the GPT-4o migration. Review useCaptureFlow and the S3 bucket.'
  );
  for (const expected of ['Jane Okafor', 'Project Aurora', 'GPT-4o', 'useCaptureFlow', 'S3']) {
    assert.ok(terms.includes(expected), `expected ${expected} in ${JSON.stringify(terms)}`);
  }
});

test('single words capitalised only by sentence position are skipped', () => {
  const terms = extractKeyterms('Sync with the team. Review the plan. Update the docs.');
  for (const noise of ['Sync', 'Review', 'Update']) {
    assert.ok(!terms.includes(noise), `${noise} should not be a keyterm`);
  }
});

test('a multi-word run survives even when it starts with a common word', () => {
  // "Review" alone is noise; "Review Board" is a name. Capitalisation carrying
  // across a word boundary is the signal.
  assert.ok(extractKeyterms('The Review Board meets friday.').includes('Review Board'));
});

test('terms are deduplicated case-insensitively', () => {
  const terms = extractKeyterms('Aurora is the codename. Talk to Aurora about aurora.');
  assert.strictEqual(terms.filter((t) => t.toLowerCase() === 'aurora').length, 1);
});

test('empty and missing context produce no terms', () => {
  assert.deepStrictEqual(extractKeyterms(''), []);
  assert.deepStrictEqual(extractKeyterms(null), []);
  assert.deepStrictEqual(extractKeyterms(undefined), []);
});

test('the provider cap of 100 keyterms is respected', () => {
  // 200 distinct capitalised tokens, well past the documented limit.
  const context = Array.from({ length: 200 }, (_, i) => `Alpha${i}`).join(' ');
  assert.ok(extractKeyterms(context).length <= 100);
});

// --- buildPrompt ---------------------------------------------------------------

test('the prompt carries both the role and the context', () => {
  const prompt = buildPrompt('Quarterly planning for the payments team.', 'engineering manager');
  assert.match(prompt, /engineering manager/);
  assert.match(prompt, /Quarterly planning/);
});

test('a missing role still yields a usable prompt', () => {
  assert.strictEqual(buildPrompt('Design review.', null), 'Design review.');
});

test('no context and no role means no prompt at all', () => {
  // null rather than '' so the caller omits the parameter instead of sending it empty.
  assert.strictEqual(buildPrompt('', null), null);
});

test('the prompt is truncated to the 1750-character limit', () => {
  assert.strictEqual(buildPrompt('x'.repeat(5000), null).length, 1750);
});

// --- wiring --------------------------------------------------------------------

test('the provider derives its hints from the context it is constructed with', () => {
  const provider = new AssemblyAIProvider('test-key', ['en'], {
    context: 'Roadmap call with Priya Raman about Helios.',
    role: 'product lead',
  });
  assert.ok(provider.keyterms.includes('Priya Raman'));
  assert.ok(provider.keyterms.includes('Helios'));
  assert.match(provider.prompt, /product lead/);
});

test('tuning falls back to meeting-shaped defaults, not the SDK voice-agent ones', () => {
  const provider = new AssemblyAIProvider('test-key');
  assert.strictEqual(provider.minTurnSilence, 400);
  assert.strictEqual(provider.maxTurnSilence, 1500);
  assert.strictEqual(provider.maxSpeakers, 10);
  assert.strictEqual(provider.mode, 'balanced');
  assert.strictEqual(provider.voiceFocus, null);
});
