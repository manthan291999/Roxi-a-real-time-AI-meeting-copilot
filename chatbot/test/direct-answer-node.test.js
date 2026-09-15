/**
 * Unit tests: direct_answer — the node behind the Knowledge switch.
 *
 * Covers the three things the graph relies on: it never returns sources, it
 * salvages a truncated JSON completion instead of failing the turn, and an
 * LLM failure degrades rather than throwing (a throw would abort the graph
 * and surface as a protocol Error with no answer at all).
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { createDirectAnswerNode } = require('../src/application/nodes/directAnswerNode');
const { JsonLineLogger } = require('../src/infrastructure/logging/JsonLineLogger');
const { ROUTES, DIRECT_HISTORY_TURNS } = require('../src/application/graph/constants');

const silentLogger = new JsonLineLogger({ level: 'error', sink: () => {} });

/** Minimal LlmGateway double: one canned result, records the call. */
function fakeLlm(result) {
  const calls = [];
  return {
    calls,
    model: () => 'fake-model',
    async complete(opts) {
      calls.push(opts);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

test('returns the parsed answer with no sources', async () => {
  const llm = fakeLlm({ data: { answer: '  Use a debounce.  ', followUps: ['Why?'] }, raw: '' });
  const node = createDirectAnswerNode({ llm, logger: silentLogger });

  const out = await node({ question: 'How do I debounce?', history: [] });

  assert.strictEqual(out.answer, 'Use a debounce.');
  assert.deepStrictEqual(out.sources, []);
  assert.deepStrictEqual(out.followUps, ['Why?']);
  assert.strictEqual(out.route, ROUTES.DIRECT);
  assert.strictEqual(llm.calls[0].tag, 'direct_answer');
  assert.strictEqual(llm.calls[0].expectJson, true);
});

test('salvages prose when the JSON did not parse', async () => {
  // parseJsonLoose returns null for a truncated object; the raw completion is
  // still a useful answer, and there is no evidence digest to fall back on.
  const llm = fakeLlm({ data: null, raw: '{"answer": "Half an ans' });
  const node = createDirectAnswerNode({ llm, logger: silentLogger });

  const out = await node({ question: 'Anything', history: [] });

  assert.strictEqual(out.answer, '{"answer": "Half an ans');
  assert.deepStrictEqual(out.sources, []);
  assert.deepStrictEqual(out.followUps, []);
  assert.strictEqual(out.route, ROUTES.DIRECT);
});

test('an empty completion degrades instead of returning a blank bubble', async () => {
  const llm = fakeLlm({ data: {}, raw: '   ' });
  const node = createDirectAnswerNode({ llm, logger: silentLogger });

  const out = await node({ question: 'Anything', history: [] });

  assert.ok(out.answer.includes('Knowledge'));
  assert.strictEqual(out.degradedNote, 'Direct chat unavailable (LLM error).');
  assert.strictEqual(out.route, ROUTES.DIRECT);
});

test('an LLM failure degrades and never throws', async () => {
  const node = createDirectAnswerNode({ llm: fakeLlm(new Error('network down')), logger: silentLogger });

  const out = await node({ question: 'Anything', history: [] });

  assert.deepStrictEqual(out.sources, []);
  assert.ok(out.degradedNote.length > 0);
});

test('history is trimmed, sanitised and sent as alternating turns', async () => {
  const llm = fakeLlm({ data: { answer: 'ok' }, raw: '' });
  const node = createDirectAnswerNode({ llm, logger: silentLogger });

  const history = Array.from({ length: DIRECT_HISTORY_TURNS + 6 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `turn ${i}`,
  }));
  // Junk the graph should not forward: empty and malformed entries.
  history.push({ role: 'assistant', content: '   ' }, { role: 'tool', content: null });

  await node({ question: 'Latest?', history });

  const { messages } = llm.calls[0];
  assert.strictEqual(messages[0].role, 'system');
  // system + DIRECT_HISTORY_TURNS of history + the current question.
  assert.strictEqual(messages.length, DIRECT_HISTORY_TURNS + 2);
  assert.ok(messages.every((m) => m.role === 'system' || m.role === 'user' || m.role === 'assistant'));
  assert.strictEqual(messages[messages.length - 1].content, 'Latest?');
});

test('non-array history is tolerated', async () => {
  const llm = fakeLlm({ data: { answer: 'ok' }, raw: '' });
  const node = createDirectAnswerNode({ llm, logger: silentLogger });

  await node({ question: 'Hi', history: undefined });

  assert.deepStrictEqual(llm.calls[0].messages.map((m) => m.role), ['system', 'user']);
});
