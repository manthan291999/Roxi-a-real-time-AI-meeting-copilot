/**
 * Unit tests: web_answer — Knowledge off, Web on.
 *
 * The graph relies on four behaviours here, and all four are about honesty
 * rather than mechanics: it never invents a source, it never throws, it
 * degrades to the model alone in 'auto', and it refuses to do so in
 * 'always' — where the user asked specifically for sourced facts.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { createWebAnswerNode } = require('../src/application/nodes/webAnswerNode');
const { JsonLineLogger } = require('../src/infrastructure/logging/JsonLineLogger');
const { ROUTES, DIRECT_HISTORY_TURNS } = require('../src/application/graph/constants');

const silentLogger = new JsonLineLogger({ level: 'error', sink: () => {} });

/** Minimal WebSearchGateway double: one canned result, records the request. */
function fakeWeb(result) {
  const calls = [];
  return {
    calls,
    model: () => 'fake-web-model',
    async answer(req) {
      calls.push(req);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const SEARCHED = {
  answer: 'Node 22 is the current LTS.',
  citations: [{ title: 'Node releases', url: 'https://nodejs.org/x', startIndex: 0, endIndex: 27 }],
  usedWebSearch: true,
  searchCalls: 1,
};

const NOT_SEARCHED = {
  answer: 'A debounce delays a call until input settles.',
  citations: [],
  usedWebSearch: false,
  searchCalls: 0,
};

test('a searched answer carries inline refs and matching cards', async () => {
  const web = fakeWeb(SEARCHED);
  const node = createWebAnswerNode({ web, logger: silentLogger });

  const out = await node({ question: 'Latest Node LTS?', history: [], webMode: 'auto' });

  assert.ok(out.answer.includes('[W1]'), out.answer);
  assert.strictEqual(out.sources.length, 1);
  assert.strictEqual(out.sources[0].ref, 'W1');
  assert.strictEqual(out.sources[0].sourceType, 'web');
  assert.strictEqual(out.sources[0].url, 'https://nodejs.org/x');
  assert.strictEqual(out.usedWebSearch, true);
  assert.strictEqual(out.webSearchCount, 1);
  assert.strictEqual(out.route, ROUTES.WEB);
  assert.strictEqual(web.calls[0].tag, 'web_answer');
});

test('the model declining to search yields no sources and no refs', async () => {
  // The whole point of 'auto': a stable question costs one plain call.
  const node = createWebAnswerNode({ web: fakeWeb(NOT_SEARCHED), logger: silentLogger });

  const out = await node({ question: 'What is a debounce?', history: [], webMode: 'auto' });

  assert.deepStrictEqual(out.sources, []);
  assert.ok(!out.answer.includes('[W'), out.answer);
  assert.strictEqual(out.usedWebSearch, false);
  assert.strictEqual(out.webSearchCount, 0);
});

test('auto passes toolChoice auto; always forces it', async () => {
  const auto = fakeWeb(SEARCHED);
  await createWebAnswerNode({ web: auto, logger: silentLogger })({ question: 'q', webMode: 'auto' });
  assert.strictEqual(auto.calls[0].toolChoice, 'auto');

  const always = fakeWeb(SEARCHED);
  await createWebAnswerNode({ web: always, logger: silentLogger })({ question: 'q', webMode: 'always' });
  assert.strictEqual(always.calls[0].toolChoice, 'required');
  // 'always' also tells the model so, in one appended paragraph.
  assert.ok(always.calls[0].messages[0].content.includes('mandatory'));
});

test('auto degrades to the injected fallback when the web is unreachable', async () => {
  let fellBack = false;
  const fallback = async () => {
    fellBack = true;
    return { answer: 'From my own knowledge.', sources: [], followUps: [], route: ROUTES.DIRECT };
  };
  const node = createWebAnswerNode({
    web: fakeWeb(new Error('network down')), logger: silentLogger, fallback,
  });

  const out = await node({ question: 'q', webMode: 'auto' });

  assert.strictEqual(fellBack, true);
  assert.strictEqual(out.answer, 'From my own knowledge.');
  assert.deepStrictEqual(out.sources, []);
  assert.strictEqual(out.usedWebSearch, false);
  assert.ok(out.degradedNote.includes('without the web'), out.degradedNote);
});

test('always refuses to degrade — an unsourced answer there would mislead', async () => {
  let fellBack = false;
  const fallback = async () => { fellBack = true; return { answer: 'nope' }; };
  const node = createWebAnswerNode({
    web: fakeWeb(new Error('network down')), logger: silentLogger, fallback,
  });

  const out = await node({ question: 'q', webMode: 'always' });

  assert.strictEqual(fellBack, false);
  assert.ok(out.answer.includes("couldn't reach the web"), out.answer);
  assert.deepStrictEqual(out.sources, []);
  assert.strictEqual(out.degradedNote, 'Web search unavailable.');
});

test('an empty completion degrades instead of returning a blank bubble', async () => {
  const node = createWebAnswerNode({
    web: fakeWeb({ answer: '', citations: [], usedWebSearch: false, searchCalls: 0 }),
    logger: silentLogger,
  });

  const out = await node({ question: 'q', webMode: 'always' });
  assert.ok(out.degradedNote.length > 0);
});

test('a failure with no fallback wired still never throws', async () => {
  const node = createWebAnswerNode({ web: fakeWeb(new Error('boom')), logger: silentLogger });
  const out = await node({ question: 'q', webMode: 'auto' });
  assert.strictEqual(out.route, ROUTES.WEB);
  assert.ok(out.degradedNote.length > 0);
});

test('history travels as bounded alternating turns', async () => {
  const web = fakeWeb(NOT_SEARCHED);
  const node = createWebAnswerNode({ web, logger: silentLogger });

  const history = Array.from({ length: DIRECT_HISTORY_TURNS + 5 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant', content: `turn ${i}`,
  }));
  history.push({ role: 'assistant', content: '   ' }, { role: 'tool', content: null });

  await node({ question: 'And now?', history, webMode: 'auto' });

  const { messages } = web.calls[0];
  assert.strictEqual(messages[0].role, 'system');
  assert.strictEqual(messages.length, DIRECT_HISTORY_TURNS + 2);
  assert.strictEqual(messages[messages.length - 1].content, 'And now?');
});

test('follow-up chips survive the plain-text path', async () => {
  // JSON is unavailable here without invalidating every citation offset,
  // so the chips ride a trailing marker line instead. Without this the
  // chips would vanish from every answer once the web is always on.
  const web = fakeWeb({
    answer: 'Node 22 is the current LTS.\nFOLLOWUPS: When does 22 go EOL? | What is on Current?',
    citations: [],
    usedWebSearch: false,
    searchCalls: 0,
  });
  const node = createWebAnswerNode({ web, logger: silentLogger });

  const out = await node({ question: 'Latest Node LTS?', webMode: 'auto' });

  assert.strictEqual(out.answer, 'Node 22 is the current LTS.');
  assert.deepStrictEqual(out.followUps, ['When does 22 go EOL?', 'What is on Current?']);
});

test('a reply that is nothing but a trailer degrades, not answers blankly', async () => {
  const web = fakeWeb({ answer: 'FOLLOWUPS: a | b', citations: [], usedWebSearch: false, searchCalls: 0 });
  const node = createWebAnswerNode({ web, logger: silentLogger });

  const out = await node({ question: 'q', webMode: 'always' });

  assert.ok(out.degradedNote.length > 0);
});
