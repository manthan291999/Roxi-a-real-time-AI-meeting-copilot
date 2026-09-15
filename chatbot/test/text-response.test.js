/**
 * Unit tests: splitFollowUps — the plain-text trailer that carries follow-up
 * chips on the web path, where JSON would break citation offsets.
 *
 * The cases that matter are the ones where the marker must NOT be honoured:
 * treating a mid-answer mention as a trailer silently truncates the answer.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { splitFollowUps } = require('../src/infrastructure/llm/textResponse');

test('a trailer is split off and the body keeps everything above it', () => {
  const { body, followUps } = splitFollowUps(
    'Node 22 is LTS.\n\nFOLLOWUPS: When does 22 go EOL? | What is Current?'
  );
  assert.strictEqual(body, 'Node 22 is LTS.');
  assert.deepStrictEqual(followUps, ['When does 22 go EOL?', 'What is Current?']);
});

test('no trailer leaves the reply completely untouched', () => {
  const text = 'Just an answer.\nWith two lines.';
  assert.deepStrictEqual(splitFollowUps(text), { body: text, followUps: [] });
});

test('the marker is honoured only on the last non-empty line', () => {
  // A model that discusses the convention mid-answer has not written a
  // trailer, and truncating there would delete most of the reply.
  const text = 'First I will explain FOLLOWUPS: they are chips.\n\nThen the real answer.';
  assert.deepStrictEqual(splitFollowUps(text), { body: text, followUps: [] });
});

test('trailing blank lines do not hide the trailer', () => {
  const { body, followUps } = splitFollowUps('Answer.\nFOLLOWUPS: a | b\n\n   \n');
  assert.strictEqual(body, 'Answer.');
  assert.deepStrictEqual(followUps, ['a', 'b']);
});

test('FOLLOW-UPS with a hyphen, and any casing, is accepted', () => {
  assert.deepStrictEqual(splitFollowUps('A.\nfollow-ups: x').followUps, ['x']);
  assert.deepStrictEqual(splitFollowUps('A.\nFollowUps: y').followUps, ['y']);
});

test('an empty or blank trailer yields no chips and still strips the line', () => {
  const { body, followUps } = splitFollowUps('Answer.\nFOLLOWUPS:');
  assert.strictEqual(body, 'Answer.');
  assert.deepStrictEqual(followUps, []);
  assert.deepStrictEqual(splitFollowUps('Answer.\nFOLLOWUPS:  |  | ').followUps, []);
});

test('more than three questions are capped, matching the chip row', () => {
  assert.deepStrictEqual(
    splitFollowUps('A.\nFOLLOWUPS: a | b | c | d | e').followUps,
    ['a', 'b', 'c']
  );
});

test('a code block ending the reply is never mistaken for a trailer', () => {
  const text = 'Run this:\n\n```bash\nnvm install --lts\n```';
  assert.deepStrictEqual(splitFollowUps(text), { body: text, followUps: [] });
});

test('empty and non-string input is tolerated', () => {
  assert.deepStrictEqual(splitFollowUps(''), { body: '', followUps: [] });
  assert.deepStrictEqual(splitFollowUps(null), { body: '', followUps: [] });
  assert.deepStrictEqual(splitFollowUps(undefined), { body: '', followUps: [] });
});
