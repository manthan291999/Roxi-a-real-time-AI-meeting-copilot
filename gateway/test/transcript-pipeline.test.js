/**
 * Utterance assembly in TranscriptPipeline.
 *
 * The behaviour under test is that a provider's turn granularity stops being
 * the app's line granularity: fragments accumulate into one Final, while the
 * live partial shows the sentence growing word by word.
 */

const test = require('node:test');
const assert = require('node:assert');
const { TranscriptPipeline } = require('../stt/transcript-pipeline');
const { TranscriptSanitizer } = require('../stt/transcript-sanitizer');

/** A short gap so the timer paths finish inside a test. */
const GAP = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makePipeline({ utteranceGapMs = GAP } = {}) {
  const partials = [];
  const finals = [];
  const saved = [];
  const attributed = [];

  const pipeline = new TranscriptPipeline({
    diarization: {
      // Display name deliberately differs from the STT label, so a test can tell
      // which one reached the protocol.
      resolveLabel: (l) => `Name<${l}>`,
      attributeTurn: (l) => attributed.push(l),
    },
    sanitizer: new TranscriptSanitizer(),
    transcripts: { save: (speaker, text) => saved.push({ speaker, text }) },
    protocol: {
      emitPartial: (text, speaker, sttLabel) => partials.push({ text, speaker, sttLabel }),
      emitFinal: (text, speaker, sttLabel, start, end, turnOrder) =>
        finals.push({ text, speaker, sttLabel, start, end, turnOrder }),
    },
    utteranceGapMs,
  });

  return { pipeline, partials, finals, saved, attributed };
}

/** One provider turn, as assemblyai.js emits it. */
const turn = (text, speaker, extra = {}) => ({
  text,
  speaker,
  confidence: 0.9,
  start: 0,
  end: 1,
  ...extra,
});

test('TranscriptPipeline utterance assembly', async (t) => {
  await t.test('joins fragments from one speaker into a single final', async () => {
    const { pipeline, finals, saved } = makePipeline();

    // The exact fragmentation seen in meeting 115.
    pipeline.onFinal(turn('Hey there.', 'Speaker C'));
    pipeline.onFinal(turn('How are', 'Speaker C'));
    pipeline.onFinal(turn('you?', 'Speaker C'));

    assert.strictEqual(finals.length, 0, 'nothing committed while the speaker continues');

    await sleep(GAP * 3);

    assert.strictEqual(finals.length, 1);
    assert.strictEqual(finals[0].text, 'Hey there. How are you?');
    assert.deepStrictEqual(saved, [{ speaker: 'Name<Speaker C>', text: 'Hey there. How are you?' }]);
  });

  await t.test('a committed fragment emits a partial, never a final', () => {
    const { pipeline, partials, finals } = makePipeline();

    pipeline.onFinal(turn('Hey there.', 'Speaker C'));

    assert.strictEqual(finals.length, 0);
    assert.strictEqual(partials.length, 1, 'the line must keep standing');
    assert.strictEqual(partials[0].text, 'Hey there.');
    assert.strictEqual(partials[0].speaker, 'Name<Speaker C>');
    assert.strictEqual(partials[0].sttLabel, 'Speaker C');
  });

  await t.test('the live partial shows committed text plus the words being said', () => {
    const { pipeline, partials } = makePipeline();

    pipeline.onFinal(turn('Hey there.', 'Speaker C'));
    pipeline.onPartial({ text: 'How are', speaker: 'Speaker C' });

    assert.strictEqual(partials.at(-1).text, 'Hey there. How are');
  });

  await t.test('a partial with no utterance in flight passes straight through', () => {
    const { pipeline, partials } = makePipeline();

    pipeline.onPartial({ text: 'Hey', speaker: 'Speaker A' });

    assert.strictEqual(partials.at(-1).text, 'Hey');
  });

  await t.test('another speaker finishing flushes the first immediately', () => {
    const { pipeline, finals } = makePipeline();

    pipeline.onFinal(turn('Hey there.', 'Speaker A'));
    pipeline.onFinal(turn('How are', 'Speaker A'));
    pipeline.onFinal(turn('Fine thanks.', 'Speaker B'));

    // A flushes without waiting for its timer; B is still open.
    assert.strictEqual(finals.length, 1);
    assert.strictEqual(finals[0].text, 'Hey there. How are');
    assert.strictEqual(finals[0].sttLabel, 'Speaker A');
  });

  await t.test('two speakers keep separate lines rather than interleaving', async () => {
    const { pipeline, finals } = makePipeline();

    pipeline.onFinal(turn('Hey there.', 'Speaker A'));
    pipeline.onFinal(turn('Fine thanks.', 'Speaker B'));
    await sleep(GAP * 3);

    assert.deepStrictEqual(
      finals.map((f) => f.text),
      ['Hey there.', 'Fine thanks.']
    );
  });

  await t.test('the gap timer commits exactly once', async () => {
    const { pipeline, finals } = makePipeline();

    pipeline.onFinal(turn('Hello world.', 'Speaker A'));
    await sleep(GAP * 3);
    await sleep(GAP * 3);

    assert.strictEqual(finals.length, 1);
  });

  await t.test('a lone fragment still becomes a final', async () => {
    const { pipeline, finals } = makePipeline();

    pipeline.onFinal(turn('Yes.', 'Speaker A'));
    await sleep(GAP * 3);

    assert.strictEqual(finals.length, 1);
    assert.strictEqual(finals[0].text, 'Yes.');
  });

  await t.test('flushAll commits what is in flight — the shutdown path', () => {
    const { pipeline, finals, saved } = makePipeline({ utteranceGapMs: 60_000 });

    pipeline.onFinal(turn('The last thing', 'Speaker A'));
    pipeline.onFinal(turn('anybody said.', 'Speaker A'));
    assert.strictEqual(finals.length, 0);

    pipeline.flushAll();

    assert.strictEqual(finals.length, 1);
    assert.strictEqual(finals[0].text, 'The last thing anybody said.');
    assert.strictEqual(saved.length, 1);
  });

  await t.test('flushAll on an empty pipeline is a no-op', () => {
    const { pipeline, finals } = makePipeline();
    pipeline.flushAll();
    assert.strictEqual(finals.length, 0);
  });

  await t.test('the final carries the first fragment\'s turnOrder and spans the utterance', async () => {
    const { pipeline, finals } = makePipeline();

    pipeline.onFinal(turn('Hey there.', 'Speaker A', { turnOrder: 7, start: 100, end: 200 }));
    pipeline.onFinal(turn('How are you?', 'Speaker A', { turnOrder: 8, start: 220, end: 400 }));
    await sleep(GAP * 3);

    assert.strictEqual(finals[0].turnOrder, 7, 'revisions name the turn they correct by its first index');
    assert.strictEqual(finals[0].start, 100);
    assert.strictEqual(finals[0].end, 400);
  });

  await t.test('a sanitizer-dropped fragment does not wipe the utterance in flight', () => {
    const { pipeline, partials, finals } = makePipeline();

    pipeline.onFinal(turn('Hey there.', 'Speaker A'));
    // Blocklisted outright, so it never joins the utterance.
    pipeline.onFinal(turn('thanks for watching', 'Speaker A'));

    assert.strictEqual(finals.length, 0);
    assert.strictEqual(partials.at(-1).text, 'Hey there.', 'the standing sentence is re-sent, not cleared');
  });

  await t.test('a dropped fragment with nothing in flight still retires the partial', () => {
    const { pipeline, partials } = makePipeline();

    pipeline.onFinal(turn('thanks for watching', 'Speaker A'));

    assert.strictEqual(partials.at(-1).text, '', 'empty text is the withdrawal signal');
  });

  await t.test('an invalid event retires the partial without throwing', () => {
    const { pipeline, partials, finals } = makePipeline();

    pipeline.onFinal({ text: '   ', speaker: 'Speaker A', confidence: 0.9 });

    assert.strictEqual(finals.length, 0);
    assert.strictEqual(partials.at(-1).text, '');
  });

  await t.test('audio is attributed per fragment, not per committed line', async () => {
    const { pipeline, attributed } = makePipeline();

    pipeline.onFinal(turn('Hey there.', 'Speaker A'));
    pipeline.onFinal(turn('How are', 'Speaker A'));
    pipeline.onFinal(turn('you?', 'Speaker A'));
    await sleep(GAP * 3);

    assert.deepStrictEqual(attributed, ['Speaker A', 'Speaker A', 'Speaker A']);
  });
});
