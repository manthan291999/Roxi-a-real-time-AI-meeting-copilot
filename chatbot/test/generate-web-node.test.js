/**
 * Unit tests: generate_web — evidence AND a web tool.
 *
 * The behaviour that matters is the attribution boundary: internal cards come
 * from refs the model wrote in the prose, web cards from what it actually
 * retrieved, and the two are never confused for each other.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { createGenerateWebNode } = require('../src/application/nodes/generateWebNode');
const { JsonLineLogger } = require('../src/infrastructure/logging/JsonLineLogger');
const { ROUTES } = require('../src/application/graph/constants');

const silentLogger = new JsonLineLogger({ level: 'error', sink: () => {} });

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

/** Evidence in the shape grade_documents leaves it — refs already stamped. */
const EVIDENCE = [
  {
    ref: 'M1', sourceType: 'meeting', groupKey: 'meeting:1', meetingId: 1,
    meetingDate: '2026-08-01', speaker: 'Speaker A', sourceTable: 'transcripts',
    sourceId: 1, text: 'We decided to use SQLite', score: 2.5,
  },
  {
    ref: 'D1', sourceType: 'document', groupKey: 'doc:d-1', meetingId: null,
    docId: 'd-1', fileName: 'architecture.pdf', pageNumber: 7,
    sourceTable: 'documents', sourceId: 'chunk-9', text: 'WAL is mandated', score: 0.8,
  },
];

test('internal and web citations both resolve, and stay apart', async () => {
  const web = fakeWeb({
    answer: 'We chose SQLite [M1] and the doc mandates WAL [D1]; SQLite 3.46 is current.',
    citations: [{ title: 'SQLite releases', url: 'https://sqlite.org/changes', startIndex: 46, endIndex: 73 }],
    usedWebSearch: true,
    searchCalls: 1,
  });
  const node = createGenerateWebNode({ web, logger: silentLogger });

  const out = await node({ question: 'what database and is it current?', evidence: EVIDENCE, webMode: 'auto' });

  assert.strictEqual(out.route, ROUTES.GENERATE_WEB);
  const refs = out.sources.map((s) => s.ref);
  assert.deepStrictEqual(refs, ['M1', 'D1', 'W1']);
  const meeting = out.sources.find((s) => s.sourceType === 'meeting');
  const doc = out.sources.find((s) => s.sourceType === 'document');
  const site = out.sources.find((s) => s.sourceType === 'web');
  assert.strictEqual(meeting.meetingId, 1);
  assert.strictEqual(doc.fileName, 'architecture.pdf');
  assert.strictEqual(site.url, 'https://sqlite.org/changes');
  // A web card must never acquire a meeting id, and vice versa.
  assert.ok(!('meetingId' in site));
  assert.ok(!('url' in meeting));
  assert.strictEqual(out.usedWebSearch, true);
});

test('an uncited evidence group is dropped, exactly as generate does it', async () => {
  const web = fakeWeb({
    answer: 'SQLite [M1] it is.', citations: [], usedWebSearch: false, searchCalls: 0,
  });
  const node = createGenerateWebNode({ web, logger: silentLogger });

  const out = await node({ question: 'q', evidence: EVIDENCE, webMode: 'auto' });

  assert.deepStrictEqual(out.sources.map((s) => s.ref), ['M1']);
});

test('the evidence block reaches the prompt with its citation tokens', async () => {
  const web = fakeWeb({ answer: 'ok [M1]', citations: [], usedWebSearch: false, searchCalls: 0 });
  const node = createGenerateWebNode({ web, logger: silentLogger });

  await node({ question: 'what database?', evidence: EVIDENCE, webMode: 'auto' });

  const userMsg = web.calls[0].messages[1].content;
  assert.ok(userMsg.includes('[M1]'), userMsg);
  assert.ok(userMsg.includes('architecture.pdf'), userMsg);
  assert.ok(userMsg.includes('Question: what database?'), userMsg);
});

test('empty evidence is a normal input and says so in the prompt', async () => {
  // The exhausted-retrieval branch lands here rather than at respond_no_data.
  const web = fakeWeb({
    answer: 'Nothing in your meetings, but the docs say X.',
    citations: [{ title: 'Docs', url: 'https://d.example', startIndex: 0, endIndex: 44 }],
    usedWebSearch: true, searchCalls: 1,
  });
  const node = createGenerateWebNode({ web, logger: silentLogger });

  const out = await node({ question: 'kubernetes plan?', evidence: [], webMode: 'auto' });

  assert.ok(web.calls[0].messages[1].content.includes('(none'), 'prompt should state the records were empty');
  assert.deepStrictEqual(out.sources.map((s) => s.ref), ['W1']);
});

test('web failure with evidence falls back to generate, and says why', async () => {
  let fellBack = false;
  const fallback = async () => {
    fellBack = true;
    return { answer: 'Grounded answer [M1].', sources: [{ ref: 'M1' }], followUps: [], route: ROUTES.GENERATE };
  };
  const node = createGenerateWebNode({
    web: fakeWeb(new Error('network down')), logger: silentLogger, fallback,
  });

  const out = await node({ question: 'q', evidence: EVIDENCE, webMode: 'always' });

  // Even in 'always': a cited answer from their own records beats a refusal,
  // and the note keeps it honest about what was missing.
  assert.strictEqual(fellBack, true);
  assert.strictEqual(out.answer, 'Grounded answer [M1].');
  assert.ok(out.degradedNote.includes('web search unavailable'), out.degradedNote);
  assert.strictEqual(out.usedWebSearch, false);
});

test('web failure with no evidence falls back to respond_no_data', async () => {
  let noData = false;
  const noDataFallback = async () => {
    noData = true;
    return { answer: "I couldn't find anything.", sources: [], followUps: [], route: ROUTES.NO_DATA };
  };
  const node = createGenerateWebNode({
    web: fakeWeb(new Error('boom')), logger: silentLogger,
    fallback: async () => ({ answer: 'WRONG FALLBACK' }),
    noDataFallback,
  });

  const out = await node({ question: 'q', evidence: [], webMode: 'auto' });

  assert.strictEqual(noData, true);
  assert.ok(out.answer.includes("couldn't find"), out.answer);
});

test('a failure with nothing wired still never throws', async () => {
  const node = createGenerateWebNode({ web: fakeWeb(new Error('boom')), logger: silentLogger });
  const out = await node({ question: 'q', evidence: [], webMode: 'auto' });
  assert.strictEqual(out.route, ROUTES.GENERATE_WEB);
  assert.ok(out.degradedNote.length > 0);
});

test('meeting role framing is applied when the store offers one', async () => {
  const web = fakeWeb({ answer: 'ok [M1]', citations: [], usedWebSearch: false, searchCalls: 0 });
  const store = { getMeetingRole: (id) => (id === 1 ? 'engineering manager' : null) };
  const node = createGenerateWebNode({ web, logger: silentLogger, store });

  await node({ question: 'q', evidence: EVIDENCE, webMode: 'auto' });

  assert.ok(web.calls[0].messages[0].content.includes('engineering manager'));
});

test('follow-up chips survive alongside citations', async () => {
  const web = fakeWeb({
    answer: 'You chose SQLite [M1].\nFOLLOWUPS: Why not Postgres? | Is WAL on?',
    citations: [],
    usedWebSearch: false,
    searchCalls: 0,
  });
  const node = createGenerateWebNode({ web, logger: silentLogger });

  const out = await node({ question: 'q', evidence: EVIDENCE, webMode: 'auto' });

  assert.strictEqual(out.answer, 'You chose SQLite [M1].');
  assert.deepStrictEqual(out.followUps, ['Why not Postgres?', 'Is WAL on?']);
  // The trailer must not be mistaken for a citation ref.
  assert.deepStrictEqual(out.sources.map((s) => s.ref), ['M1']);
});

test('the trailer is stripped before refs are read, not after', async () => {
  // A [D1] mentioned only inside a follow-up question is not a citation:
  // it must not pull a source card the answer never cited.
  const web = fakeWeb({
    answer: 'SQLite [M1] it is.\nFOLLOWUPS: What does [D1] say about WAL?',
    citations: [],
    usedWebSearch: false,
    searchCalls: 0,
  });
  const node = createGenerateWebNode({ web, logger: silentLogger });

  const out = await node({ question: 'q', evidence: EVIDENCE, webMode: 'auto' });

  assert.deepStrictEqual(out.sources.map((s) => s.ref), ['M1']);
});
