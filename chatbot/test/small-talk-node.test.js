/**
 * Unit tests: small_talk — the guardrail's terminal node.
 *
 * Covers: it renders exactly what triage() decided, it never returns
 * sources (same rule direct_answer follows — no citation without a real
 * search), and the defensive re-entry-mismatch branch degrades instead of
 * throwing when triage() disagrees with itself between calls (which should
 * never happen in production, since decideEntry and this node both classify
 * the exact same state — see routing.js).
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { createSmallTalkNode } = require('../src/application/nodes/smallTalkNode');
const { JsonLineLogger } = require('../src/infrastructure/logging/JsonLineLogger');
const { ROUTES, MODES } = require('../src/application/graph/constants');

const silentLogger = new JsonLineLogger({ level: 'error', sink: () => {} });

test('a greeting renders triage\'s canned answer and follow-ups, with no sources', async () => {
  const node = createSmallTalkNode({ logger: silentLogger });

  const out = await node({ question: 'hi', mode: MODES.RAG });

  assert.ok(out.answer.length > 0);
  assert.deepStrictEqual(out.sources, []);
  assert.ok(Array.isArray(out.followUps) && out.followUps.length > 0);
  assert.strictEqual(out.route, ROUTES.SMALL_TALK);
});

test('mode is respected — direct mode gets no meeting-shaped follow-ups', async () => {
  const node = createSmallTalkNode({ logger: silentLogger });

  const out = await node({ question: 'hi', mode: MODES.DIRECT });

  assert.deepStrictEqual(out.followUps, []);
  assert.strictEqual(out.route, ROUTES.SMALL_TALK);
});

test('help renders the capability description', async () => {
  const node = createSmallTalkNode({ logger: silentLogger });

  const out = await node({ question: 'what can you do', mode: MODES.RAG });

  assert.ok(out.answer.toLowerCase().includes('search'));
  assert.strictEqual(out.route, ROUTES.SMALL_TALK);
});

test('a real question reaching this node on its own (bypassing decideEntry) degrades safely', async () => {
  // This node is only ever reached after decideEntry already found
  // intercept:true on the exact same state, so a real question landing here
  // should not happen — but the node must not crash if it does.
  const node = createSmallTalkNode({ logger: silentLogger });

  const out = await node({ question: 'What decisions have we made recently?', mode: MODES.RAG });

  assert.strictEqual(out.answer, '');
  assert.deepStrictEqual(out.sources, []);
  assert.deepStrictEqual(out.followUps, []);
  assert.strictEqual(out.route, ROUTES.SMALL_TALK);
  assert.ok(out.degradedNote.length > 0);
});

test('works with no logger supplied', async () => {
  const node = createSmallTalkNode();
  const out = await node({ question: 'hello', mode: MODES.RAG });
  assert.strictEqual(out.route, ROUTES.SMALL_TALK);
});

test('gibberish is intercepted and echoed onto the guardrail field', async () => {
  const node = createSmallTalkNode({ logger: silentLogger, corpusProbe: { has: () => false } });

  const out = await node({ question: 'hbvxvsjhvbcjhvjbcx jbh cbh', mode: MODES.RAG });

  assert.strictEqual(out.route, ROUTES.SMALL_TALK);
  assert.strictEqual(out.guardrail, 'gibberish');
  assert.deepStrictEqual(out.sources, []);
});

test('corpusProbe is threaded through to the gibberish gate — a corpus hit rescues the term', async () => {
  const node = createSmallTalkNode({ logger: silentLogger, corpusProbe: { has: () => true } });

  const out = await node({ question: 'What decisions have we made recently?', mode: MODES.RAG });

  // Rescued from gibberish by the probe, same as any real question — falls
  // to the defensive re-entry branch here only because this test calls the
  // node directly rather than through decideEntry (see the test above this
  // one in spirit): the point is `guardrail` reads '' when not intercepted.
  assert.strictEqual(out.guardrail, '');
});

test('every intercepted kind sets the guardrail field to that kind', async () => {
  const node = createSmallTalkNode({ logger: silentLogger });
  const cases = [
    ['hi', 'greeting'],
    ['help', 'help'],
    ['yes', 'ack'],
    ['', 'empty'],
  ];
  for (const [question, kind] of cases) {
    const out = await node({ question, mode: MODES.RAG });
    assert.strictEqual(out.guardrail, kind, `question=${JSON.stringify(question)}`);
  }
});
