/**
 * Integration tests: full LangGraph with a scripted FakeLlm.
 * Covers every route (generate, clarify, rewrite->generate, no_data,
 * ambiguous-no-evidence->clarify) with ZERO API cost.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const { SqliteMeetingStore } = require('../src/infrastructure/persistence/SqliteMeetingStore');
const { FtsIndexBuilder } = require('../src/infrastructure/persistence/FtsIndexBuilder');
const { FtsRetriever } = require('../src/infrastructure/persistence/FtsRetriever');
const { buildChatGraph } = require('../src/application/graph/buildChatGraph');
const { AnswerQuestionUseCase } = require('../src/application/useCases/AnswerQuestionUseCase');
const { createAnalyzeQueryNode } = require('../src/application/nodes/analyzeQueryNode');
const { createRetrieveNode } = require('../src/application/nodes/retrieveNode');
const { FtsEvidenceSource } = require('../src/infrastructure/persistence/FtsEvidenceSource');
const { createGradeDocumentsNode } = require('../src/application/nodes/gradeDocumentsNode');
const { createRewriteQueryNode } = require('../src/application/nodes/rewriteQueryNode');
const { createClarifyNode } = require('../src/application/nodes/clarifyNode');
const { createGenerateNode } = require('../src/application/nodes/generateNode');
const { createRespondNoDataNode } = require('../src/application/nodes/respondNoDataNode');
const { createDirectAnswerNode } = require('../src/application/nodes/directAnswerNode');
const { createWebAnswerNode } = require('../src/application/nodes/webAnswerNode');
const { createGenerateWebNode } = require('../src/application/nodes/generateWebNode');
const { createSmallTalkNode } = require('../src/application/nodes/smallTalkNode');
const { JsonLineLogger } = require('../src/infrastructure/logging/JsonLineLogger');

/** Scripted LlmGateway double — canned JSON per tag, records calls. */
class FakeLlm {
  constructor(scripts = {}) {
    this.scripts = scripts; // tag -> object | fn(tag, messages) -> object | Error
    this.calls = [];
  }
  model() { return 'fake-model'; }
  async complete({ messages, expectJson, tag }) {
    this.calls.push(tag);
    const script = this.scripts[tag];
    const data = typeof script === 'function' ? script(tag, messages) : script;
    if (data instanceof Error) throw data;
    return { data: expectJson ? (data ?? {}) : JSON.stringify(data ?? {}), raw: '', latencyMs: 1, model: 'fake-model' };
  }
}

const silentLogger = new JsonLineLogger({ level: 'error', sink: () => {} });

/** Grade script: mark every candidate relevant. */
const allRelevant = (tag, messages) => {
  const count = (messages[1].content.match(/^\[\d+\]/gm) || []).length;
  return { relevantIndices: Array.from({ length: count }, (_, i) => i), reason: 'test' };
};

let dir, store, builder, retriever;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-graph-test-'));
  const meetingDbPath = path.join(dir, 'meetings.db');
  const indexDbPath = path.join(dir, 'index.db');

  const db = new Database(meetingDbPath);
  db.exec(`
    CREATE TABLE meetings (id INTEGER PRIMARY KEY, start_time DATETIME, end_time DATETIME, summary TEXT, context TEXT, name TEXT, status TEXT DEFAULT 'ended', api_calls INTEGER DEFAULT 0, provider TEXT);
    CREATE TABLE transcripts (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER, speaker TEXT, text TEXT);
    CREATE TABLE summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER, kind TEXT, text TEXT);
    CREATE TABLE decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER, description TEXT, confidence REAL, chunk_id INTEGER);
    CREATE TABLE action_items (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER, assignee TEXT, description TEXT, deadline TEXT, chunk_id INTEGER);
    CREATE TABLE risks (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER, chunk_id INTEGER, text TEXT, category TEXT, severity TEXT);

    INSERT INTO meetings (id, start_time, status) VALUES (1, '2026-08-01 10:00:00', 'ended');
    INSERT INTO meetings (id, start_time, status) VALUES (2, '2026-08-02 11:00:00', 'ended');
    INSERT INTO transcripts (meeting_id, speaker, text) VALUES
      (1, 'Speaker A', 'We decided to use SQLite for the local database'),
      (1, 'Speaker B', 'The payment webhook keeps timing out in production'),
      (2, 'Speaker A', 'Let us retry the webhook with exponential backoff');
    INSERT INTO summaries (meeting_id, kind, text) VALUES
      (2, 'executive', 'Meeting about webhook reliability and retry strategy.');
  `);
  db.close();

  store = new SqliteMeetingStore(meetingDbPath);
  builder = new FtsIndexBuilder(indexDbPath);
  builder.rebuild(store);
  retriever = new FtsRetriever(indexDbPath);
});

after(() => {
  store.close(); builder.close(); retriever.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * @param {{guardrail?: boolean}} [opts] guardrail: wire the zero-LLM
 *   small_talk node, mirroring container.js's CHATBOT_GUARDRAIL='on' path.
 *   Every pre-existing test below calls makeUseCase without this — matching
 *   a container built with the guardrail off — so those tests double as the
 *   "capability not configured behaves exactly as before" proof: none of
 *   them ask a greeting, but every one of them exercises decideEntry/
 *   decideEntryByMode's fallback path on ordinary questions.
 */
function makeUseCase(llm, evidenceSource = null, web = null, defaultWebMode = undefined, { guardrail = false } = {}) {
  const directAnswer = createDirectAnswerNode({ llm, logger: silentLogger });
  const generate = createGenerateNode({ llm, logger: silentLogger });
  const respondNoData = createRespondNoDataNode({ logger: silentLogger, retriever });

  const graph = buildChatGraph({
    ...(guardrail ? { smallTalk: createSmallTalkNode({ logger: silentLogger }) } : {}),
    analyzeQuery: createAnalyzeQueryNode({ llm, logger: silentLogger }),
    retrieve: createRetrieveNode({
      evidenceSource: evidenceSource || new FtsEvidenceSource(retriever),
      logger: silentLogger,
    }),
    gradeDocuments: createGradeDocumentsNode({ llm, logger: silentLogger }),
    rewriteQuery: createRewriteQueryNode({ llm, logger: silentLogger }),
    clarify: createClarifyNode({ llm, logger: silentLogger }),
    generate,
    respondNoData,
    directAnswer,
    ...(web
      ? {
        webAnswer: createWebAnswerNode({ web, logger: silentLogger, fallback: directAnswer }),
        generateWeb: createGenerateWebNode({
          web, logger: silentLogger, fallback: generate, noDataFallback: respondNoData,
        }),
      }
      : {}),
  });
  return new AnswerQuestionUseCase({
    graph, logger: silentLogger, ...(defaultWebMode ? { defaultWebMode } : {}),
  });
}


test('direct mode: one LLM call, no retrieval, no sources', async () => {
  const llm = new FakeLlm({
    direct_answer: { answer: 'Use `^v?\\d+\\.\\d+\\.\\d+$` for a semver tag.', followUps: ['How do I match prereleases?'] },
  });
  const useCase = makeUseCase(llm);
  const nodes = [];
  const payload = await useCase.run({
    question: 'Write a regex for a semver tag',
    threadId: 't-direct',
    mode: 'direct',
    onNode: (n) => nodes.push(n),
  });

  assert.deepStrictEqual(llm.calls, ['direct_answer']);
  assert.deepStrictEqual(nodes, ['direct_answer']);
  assert.strictEqual(payload.route, 'direct');
  assert.strictEqual(payload.mode, 'direct');
  assert.deepStrictEqual(payload.sources, []);
  assert.ok(payload.answer.includes('semver'));
  assert.deepStrictEqual(payload.followUps, ['How do I match prereleases?']);
});

test('direct mode: liveContext never reaches the prompt', async () => {
  const seen = [];
  const llm = new FakeLlm({
    direct_answer: (tag, messages) => {
      seen.push(...messages.map((m) => m.content));
      return { answer: 'Answered without the meeting.', followUps: [] };
    },
  });
  const useCase = makeUseCase(llm);
  await useCase.run({
    question: 'What is exponential backoff?',
    threadId: 't-direct-live',
    mode: 'direct',
    liveContext: 'Speaker A: SENTINEL_LIVE_LINE',
  });

  assert.ok(!seen.some((c) => c.includes('SENTINEL_LIVE_LINE')));
});

test('direct mode: history travels as real turns', async () => {
  let turns = [];
  const llm = new FakeLlm({
    direct_answer: (tag, messages) => {
      turns = messages;
      return { answer: 'Yes.', followUps: [] };
    },
  });
  const useCase = makeUseCase(llm);
  await useCase.run({
    question: 'And in TypeScript?',
    threadId: 't-direct-history',
    mode: 'direct',
    history: [
      { role: 'user', content: 'How do I debounce in JS?' },
      { role: 'assistant', content: 'Wrap it in setTimeout.' },
    ],
  });

  assert.strictEqual(turns[0].role, 'system');
  assert.deepStrictEqual(
    turns.slice(1).map((m) => m.role),
    ['user', 'assistant', 'user'],
  );
  assert.strictEqual(turns[turns.length - 1].content, 'And in TypeScript?');
});

test('direct mode: LLM failure degrades instead of throwing', async () => {
  const llm = new FakeLlm({ direct_answer: new Error('network down') });
  const useCase = makeUseCase(llm);
  const payload = await useCase.run({
    question: 'Anything',
    threadId: 't-direct-fail',
    mode: 'direct',
  });

  assert.strictEqual(payload.route, 'direct');
  assert.deepStrictEqual(payload.sources, []);
  assert.ok(payload.degradedNote.length > 0);
  assert.ok(payload.answer.includes('Knowledge'));
});

test('unknown mode falls back to retrieval', async () => {
  const llm = new FakeLlm({
    analyze_query: { searchKeywords: ['webhook'], isAmbiguous: false, ambiguityNote: '' },
    grade_documents: allRelevant,
    generate: { answer: 'Answered from meetings [M1].', citedRefs: ['M1'], followUps: [] },
  });
  const useCase = makeUseCase(llm);
  const payload = await useCase.run({
    question: 'Why does the payment webhook fail?',
    threadId: 't-mode-typo',
    mode: 'DIRECT',
  });

  assert.strictEqual(payload.mode, 'rag');
  assert.ok(llm.calls.includes('analyze_query'));
  assert.ok(!llm.calls.includes('direct_answer'));
});

test('generate route: grounded answer with sources', async () => {
  const llm = new FakeLlm({
    analyze_query: { searchKeywords: ['webhook', 'timeout'], isAmbiguous: false, ambiguityNote: '' },
    grade_documents: allRelevant,
    generate: { answer: 'The webhook times out in production [M1]; we planned retries [M2].', citedMeetingIds: [1, 2], followUps: ['What retry strategy?'] },
  });
  const useCase = makeUseCase(llm);
  const nodes = [];
  const payload = await useCase.run({
    question: 'Why does the payment webhook fail?',
    threadId: 't-generate',
    onNode: (n) => nodes.push(n),
  });

  assert.strictEqual(payload.route, 'generate');
  assert.ok(payload.answer.includes('[M1]'));
  assert.ok(payload.sources.length >= 1);
  assert.ok(payload.sources.some((s) => s.meetingId === 1));
  assert.deepStrictEqual(payload.followUps, ['What retry strategy?']);
  assert.ok(nodes.includes('analyze_query'));
  assert.ok(nodes.includes('grade_documents'));
  assert.ok(nodes.includes('generate'));
  assert.ok(!llm.calls.includes('rewrite_query'));
});

test('clarify route: ambiguous question with evidence', async () => {
  const llm = new FakeLlm({
    analyze_query: { searchKeywords: ['webhook'], isAmbiguous: true, ambiguityNote: 'which aspect is unclear' },
    grade_documents: allRelevant,
    clarify: {
      summaryOfWhatWasFound: 'Webhook issues were discussed in 2 meetings.',
      clarifyingQuestion: 'Do you want the cause or the fix?',
      options: ['What caused the timeouts?', 'What fix was planned?'],
    },
  });
  const useCase = makeUseCase(llm);
  const payload = await useCase.run({ question: 'tell me about the webhook thing', threadId: 't-clarify' });

  assert.strictEqual(payload.route, 'clarify');
  assert.strictEqual(payload.clarifyingQuestion, 'Do you want the cause or the fix?');
  assert.ok(payload.answer.includes('Webhook issues'));
  assert.strictEqual(payload.followUps.length, 2);
  assert.ok(payload.sources.length >= 1);
});

test('rewrite loop: first keywords miss, rewrite succeeds', async () => {
  const llm = new FakeLlm({
    analyze_query: { searchKeywords: ['zzznotfound'], isAmbiguous: false, ambiguityNote: '' },
    rewrite_query: { searchKeywords: ['webhook', 'retry'] },
    grade_documents: allRelevant,
    generate: { answer: 'Retry with backoff [M2].', citedMeetingIds: [2], followUps: [] },
  });
  const useCase = makeUseCase(llm);
  const payload = await useCase.run({ question: 'how do we handle failures?', threadId: 't-rewrite' });

  assert.strictEqual(payload.route, 'generate');
  assert.strictEqual(payload.attempts, 2);
  assert.ok(llm.calls.includes('rewrite_query'));
});

test('no_data route: nothing found after all attempts', async () => {
  const llm = new FakeLlm({
    analyze_query: { searchKeywords: ['kubernetes'], isAmbiguous: false, ambiguityNote: '' },
    rewrite_query: { searchKeywords: ['zzzstillnothing'] },
  });
  const useCase = makeUseCase(llm);
  const payload = await useCase.run({ question: 'kubernetes deployment plan?', threadId: 't-nodata' });

  assert.strictEqual(payload.route, 'no_data');
  assert.strictEqual(payload.attempts, 3); // initial + 2 rewrites
  assert.deepStrictEqual(payload.sources, []);
  assert.ok(payload.answer.includes("couldn't find"));
  assert.ok(!llm.calls.includes('generate'));
});

test('ambiguous + no evidence -> clarify with recent topics', async () => {
  const llm = new FakeLlm({
    analyze_query: { searchKeywords: ['qqqqnothing'], isAmbiguous: true, ambiguityNote: 'too vague' },
    rewrite_query: { searchKeywords: ['qqqqstillnothing'] },
  });
  const useCase = makeUseCase(llm);
  const payload = await useCase.run({ question: 'that thing from the meeting', threadId: 't-ambig' });

  assert.strictEqual(payload.route, 'clarify');
  assert.ok(payload.clarifyingQuestion.length > 10);
  assert.ok(payload.sources.length >= 1); // recent topics offered
  assert.ok(payload.followUps.some((f) => f.startsWith('Summarize meeting #')));
});

test('LLM failure degrades gracefully (no crash, grounded digest)', async () => {
  const llm = new FakeLlm({
    analyze_query: new Error('boom'),
    grade_documents: new Error('boom'),
    generate: new Error('boom'),
  });
  const useCase = makeUseCase(llm);
  const payload = await useCase.run({ question: 'webhook timeout', threadId: 't-degrade' });

  // Keyword fallback finds evidence; digest fallback answers without LLM.
  assert.strictEqual(payload.route, 'generate');
  assert.ok(payload.answer.length > 0);
  assert.ok(payload.sources.length >= 1);
  assert.ok(payload.degradedNote.length > 0);
});

test('rejects empty question', async () => {
  const llm = new FakeLlm({});
  const useCase = makeUseCase(llm);
  await assert.rejects(() => useCase.run({ question: '   ', threadId: 't-bad' }), /non-empty/);
});


// --- small_talk: the zero-LLM guardrail ---------------------------------

test('small_talk: a greeting costs zero LLM calls', async () => {
  // The exact regression guard the pre-router plan exists to make cheap:
  // FakeLlm.calls records every tag passed to complete(); this proves none
  // ever fires for "hi", where the pre-guardrail pipeline cost 9 real API
  // calls (analyze_query, 2x embed_query, 2x grade_documents, rewrite_query,
  // generate — see the pre-router plan §02).
  const llm = new FakeLlm({
    analyze_query: { searchKeywords: ['SHOULD NOT RUN'], isAmbiguous: false, ambiguityNote: '' },
  });
  const nodes = [];
  const payload = await makeUseCase(llm, null, null, undefined, { guardrail: true }).run({
    question: 'hi',
    threadId: 't-small-talk',
    onNode: (n) => nodes.push(n),
  });

  assert.deepStrictEqual(llm.calls, []);
  assert.deepStrictEqual(nodes, ['small_talk']);
  assert.strictEqual(payload.route, 'small_talk');
  assert.deepStrictEqual(payload.sources, []);
  assert.ok(payload.answer.length > 0);
});

test('small_talk: a real question that starts with a greeting still runs the full pipeline', async () => {
  // The whole-message rule (tokens.js's header comment), proven end to end
  // through AnswerQuestionUseCase rather than just at triage()/decideEntry —
  // "webhook" matches this suite's seeded transcripts (see `before`), so a
  // real 'generate' route is reachable, not just "some pipeline ran".
  const llm = new FakeLlm({
    analyze_query: { searchKeywords: ['webhook'], isAmbiguous: false, ambiguityNote: '' },
    grade_documents: allRelevant,
    generate: { answer: 'The webhook times out in production [M1].', citedMeetingIds: [1], followUps: [] },
  });
  const nodes = [];
  const payload = await makeUseCase(llm, null, null, undefined, { guardrail: true }).run({
    question: 'hi why does the payment webhook fail',
    threadId: 't-small-talk-real',
    onNode: (n) => nodes.push(n),
  });

  assert.ok(llm.calls.includes('analyze_query'));
  assert.ok(nodes.includes('analyze_query'));
  assert.ok(!nodes.includes('small_talk'));
  assert.strictEqual(payload.route, 'generate');
});

test('small_talk: intercepts regardless of mode — direct mode gets the same instant reply', async () => {
  const llm = new FakeLlm({
    direct_answer: { answer: 'SHOULD NOT RUN', followUps: [] },
  });
  const payload = await makeUseCase(llm, null, null, undefined, { guardrail: true }).run({
    question: 'hello',
    threadId: 't-small-talk-direct',
    mode: 'direct',
  });

  assert.deepStrictEqual(llm.calls, []);
  assert.strictEqual(payload.route, 'small_talk');
  // Direct mode consults no corpus, so no meeting-shaped follow-ups either.
  assert.deepStrictEqual(payload.followUps, []);
});

test('small_talk: guardrail not wired -> a greeting in direct mode still falls through to direct_answer, not analyze_query', async () => {
  // This is the correctness property buildChatGraph's optional-dependency
  // degradation exists for: a disabled guardrail must re-derive the SAME
  // destination decideEntryByMode would have picked, not one fixed node
  // regardless of mode — routing a direct-mode turn through analyze_query
  // would incorrectly consult the corpus after the user turned it off.
  const llm = new FakeLlm({
    direct_answer: { answer: 'Answered directly.', followUps: [] },
  });
  const nodes = [];
  const payload = await makeUseCase(llm, null, null, undefined, { guardrail: false }).run({
    question: 'hi',
    threadId: 't-small-talk-disabled',
    mode: 'direct',
    onNode: (n) => nodes.push(n),
  });

  assert.deepStrictEqual(llm.calls, ['direct_answer']);
  assert.deepStrictEqual(nodes, ['direct_answer']);
  assert.strictEqual(payload.route, 'direct');
  assert.strictEqual(payload.answer, 'Answered directly.');
});

test('small_talk: guardrail not wired -> a greeting in rag mode still runs full retrieval', async () => {
  // "hi" has no match in this suite's seeded content (SQLite/webhook/retry),
  // so the corrective loop correctly exhausts and lands on no_data — the
  // point is that it exhausts a REAL retrieval loop rather than being
  // intercepted, which analyze_query/rewrite_query both firing proves.
  const llm = new FakeLlm({
    analyze_query: { searchKeywords: ['hi'], isAmbiguous: false, ambiguityNote: '' },
    rewrite_query: { searchKeywords: ['hi'] },
  });
  const payload = await makeUseCase(llm, null, null, undefined, { guardrail: false }).run({
    question: 'hi',
    threadId: 't-small-talk-disabled-rag',
  });

  assert.ok(llm.calls.includes('analyze_query'));
  assert.ok(llm.calls.includes('rewrite_query'));
  assert.strictEqual(payload.route, 'no_data');
});


// --- small_talk: ack + the clarification stand-down (phase 4) -----------

test('ack: a bare "yes" with nothing pending is intercepted, zero LLM calls', async () => {
  const llm = new FakeLlm({
    analyze_query: { searchKeywords: ['SHOULD NOT RUN'], isAmbiguous: false, ambiguityNote: '' },
  });
  const payload = await makeUseCase(llm, null, null, undefined, { guardrail: true }).run({
    question: 'yes',
    threadId: 't-ack-fresh',
  });

  assert.deepStrictEqual(llm.calls, []);
  assert.strictEqual(payload.route, 'small_talk');
  assert.ok(payload.answer.length > 0);
});

test('THE TRAP, end to end: a clarifying question, then "yes" — the guardrail must not swallow the answer', async () => {
  // Turn 1: an ambiguous question with evidence lands on clarify (same
  // script shape as the pre-existing "clarify route" test above) and writes
  // route: 'clarify' into this thread's checkpointed state. Turn 2's "yes"
  // must reach analyze_query too, so analyze_query is scripted as a
  // function that tells the two calls apart by the question it was actually
  // asked with — a static canned response would answer both turns
  // identically and mask exactly the distinction this test exists to prove.
  const llm = new FakeLlm({
    analyze_query: (tag, messages) => {
      const isFollowUp = messages[1].content.includes('User question: yes');
      return {
        searchKeywords: ['webhook'],
        isAmbiguous: !isFollowUp,
        ambiguityNote: isFollowUp ? '' : 'which aspect is unclear',
      };
    },
    grade_documents: allRelevant,
    clarify: {
      summaryOfWhatWasFound: 'Webhook issues were discussed in 2 meetings.',
      clarifyingQuestion: 'Do you want the cause or the fix?',
      options: ['What caused the timeouts?', 'What fix was planned?'],
    },
    // Turn 2 must reach this real RAG path, not the guardrail.
    generate: { answer: 'The cause was a slow downstream service [M1].', citedMeetingIds: [1], followUps: [] },
  });
  const useCase = makeUseCase(llm, null, null, undefined, { guardrail: true });
  const threadId = 't-trap-clarify-then-yes';

  const first = await useCase.run({ question: 'tell me about the webhook thing', threadId });
  assert.strictEqual(first.route, 'clarify');

  // Turn 2: the checkpointer carries route:'clarify' forward (lastWrite
  // ignores the absent `route` in this turn's own input — see state.js and
  // pendingClarification.js), so triage() must stand down even though "yes"
  // is an exact AFFIRMATIVE_TOKENS member.
  const nodes = [];
  const second = await useCase.run({
    question: 'yes',
    threadId,
    onNode: (n) => nodes.push(n),
  });

  assert.ok(!nodes.includes('small_talk'), 'the guardrail must not have intercepted this turn');
  assert.ok(llm.calls.includes('generate'), '"yes" must have reached the real pipeline');
  assert.strictEqual(second.route, 'generate');
  assert.ok(second.answer.includes('slow downstream service'));
});

/**
 * EvidenceSource double returning one meeting hit and one document hit, in the
 * exact shape CompositeEvidenceSource emits — refs are deliberately absent,
 * because assigning them is boundEvidence's job.
 */
class MixedEvidenceSource {
  constructor() { this.name = 'mixed'; }
  async search() {
    return [
      {
        sourceType: 'meeting',
        groupKey: 'meeting:1',
        meetingId: 1,
        meetingDate: '2026-08-01',
        speaker: 'Speaker A',
        sourceTable: 'transcripts',
        sourceId: 1,
        text: 'We decided to use SQLite for the local database',
        score: 2.5,
      },
      {
        sourceType: 'document',
        groupKey: 'doc:d-1',
        meetingId: null,
        docId: 'd-1',
        fileName: 'architecture.pdf',
        pageNumber: 7,
        sourceTable: 'documents',
        sourceId: 'chunk-9',
        text: 'The datastore section mandates SQLite with WAL enabled.',
        score: 0.82,
      },
    ];
  }
}

test('mixed corpora: the model is offered both refs and cites both', async () => {
  let evidencePrompt = '';
  const llm = new FakeLlm({
    analyze_query: { searchKeywords: ['sqlite'], isAmbiguous: false, ambiguityNote: '' },
    grade_documents: allRelevant,
    generate: (tag, messages) => {
      evidencePrompt = messages[1].content;
      return {
        answer: 'SQLite was chosen [M1] and the architecture doc requires WAL [D1].',
        citedRefs: ['M1', 'D1'],
        followUps: [],
      };
    },
  });
  const useCase = makeUseCase(llm, new MixedEvidenceSource());
  const payload = await useCase.run({ question: 'what database do we use?', threadId: 't-mixed' });

  // The prompt labels each corpus with the token the model is asked to cite.
  assert.ok(evidencePrompt.includes('[M1]'));
  assert.ok(evidencePrompt.includes('[D1]'));
  assert.ok(evidencePrompt.includes('architecture.pdf · page 7'));
  assert.ok(evidencePrompt.includes('Meeting #1'));

  assert.strictEqual(payload.route, 'generate');
  assert.ok(payload.answer.includes('[M1]'));
  assert.ok(payload.answer.includes('[D1]'));

  assert.strictEqual(payload.sources.length, 2);
  const meeting = payload.sources.find((x) => x.sourceType === 'meeting');
  const document = payload.sources.find((x) => x.sourceType === 'document');
  assert.strictEqual(meeting.ref, 'M1');
  assert.strictEqual(meeting.meetingId, 1);
  assert.strictEqual(document.ref, 'D1');
  assert.strictEqual(document.fileName, 'architecture.pdf');
  assert.strictEqual(document.pageNumber, 7);
  assert.strictEqual(document.docId, 'd-1');
  assert.ok(!('meetingId' in document));
});

test('citedRefs selects a subset: an uncited document is dropped', async () => {
  const llm = new FakeLlm({
    analyze_query: { searchKeywords: ['sqlite'], isAmbiguous: false, ambiguityNote: '' },
    grade_documents: allRelevant,
    generate: { answer: 'SQLite [M1].', citedRefs: ['M1'], followUps: [] },
  });
  const useCase = makeUseCase(llm, new MixedEvidenceSource());
  const payload = await useCase.run({ question: 'what database do we use?', threadId: 't-subset' });

  assert.deepStrictEqual(payload.sources.map((x) => x.ref), ['M1']);
});

test('a legacy citedMeetingIds response still resolves its sources', async () => {
  // The pre-Phase-8 shape: a request in flight across the upgrade, or a model
  // that answers in the old format, must not lose its source cards.
  const llm = new FakeLlm({
    analyze_query: { searchKeywords: ['sqlite'], isAmbiguous: false, ambiguityNote: '' },
    grade_documents: allRelevant,
    generate: { answer: 'SQLite [M1].', citedMeetingIds: [1], followUps: [] },
  });
  const useCase = makeUseCase(llm, new MixedEvidenceSource());
  const payload = await useCase.run({ question: 'what database do we use?', threadId: 't-legacy' });

  assert.deepStrictEqual(payload.sources.map((x) => x.ref), ['M1']);
  assert.strictEqual(payload.sources[0].meetingId, 1);
});

test('degraded digest cites documents with file and page', async () => {
  const llm = new FakeLlm({
    analyze_query: { searchKeywords: ['sqlite'], isAmbiguous: false, ambiguityNote: '' },
    grade_documents: allRelevant,
    generate: new Error('boom'),
  });
  const useCase = makeUseCase(llm, new MixedEvidenceSource());
  const payload = await useCase.run({ question: 'what database do we use?', threadId: 't-digest' });

  assert.ok(payload.answer.includes('[M1]'));
  assert.ok(payload.answer.includes('[D1 architecture.pdf p7]'));
  assert.ok(payload.answer.includes('your meetings and documents'));
  assert.ok(payload.degradedNote.length > 0);
});

test('grading candidates describe documents by file, not by meeting', async () => {
  let gradePrompt = '';
  const llm = new FakeLlm({
    analyze_query: { searchKeywords: ['sqlite'], isAmbiguous: false, ambiguityNote: '' },
    grade_documents: (tag, messages) => {
      gradePrompt = messages[1].content;
      return allRelevant(tag, messages);
    },
    generate: { answer: 'SQLite [M1].', citedRefs: ['M1'], followUps: [] },
  });
  const useCase = makeUseCase(llm, new MixedEvidenceSource());
  await useCase.run({ question: 'what database do we use?', threadId: 't-grade' });

  assert.ok(gradePrompt.includes('architecture.pdf · page 7'));
  assert.ok(gradePrompt.includes('Meeting #1 · transcripts (Speaker A)'));
  // A document must never be labelled "Meeting #null".
  assert.ok(!gradePrompt.includes('Meeting #null'));
});


/**
 * Scripted WebSearchGateway double — canned result per tag, records requests.
 * Mirrors FakeLlm above so the two read the same way.
 */
class FakeWeb {
  constructor(scripts = {}) {
    this.scripts = scripts; // tag -> result | fn(req) -> result | Error
    this.calls = [];
  }
  model() { return 'fake-web-model'; }
  async answer(req) {
    this.calls.push(req);
    const script = this.scripts[req.tag];
    const out = typeof script === 'function' ? script(req) : script;
    if (out instanceof Error) throw out;
    return {
      answer: '', citations: [], usedWebSearch: false, searchCalls: 0,
      latencyMs: 1, model: 'fake-web-model', ...(out || {}),
    };
  }
}

test('web off: the graph is exactly the one that shipped before', async () => {
  // Same assertions as the plain generate-route test, with a web gateway
  // wired but webMode absent. Nothing may reach it.
  const llm = new FakeLlm({
    analyze_query: { searchKeywords: ['webhook'], isAmbiguous: false, ambiguityNote: '' },
    grade_documents: allRelevant,
    generate: { answer: 'Times out in production [M1].', citedRefs: ['M1'], followUps: [] },
  });
  const web = new FakeWeb({ generate_web: { answer: 'SHOULD NOT BE CALLED' } });
  const payload = await makeUseCase(llm, null, web).run({
    question: 'Why does the payment webhook fail?', threadId: 't-web-off',
  });

  assert.strictEqual(payload.route, 'generate');
  assert.strictEqual(payload.webMode, 'never');
  assert.strictEqual(payload.usedWebSearch, false);
  assert.deepStrictEqual(web.calls, []);
});

test('direct + web auto: one web call, no retrieval, cited cards', async () => {
  const llm = new FakeLlm({});
  const web = new FakeWeb({
    web_answer: {
      answer: 'Node 22 is the current LTS.',
      citations: [{ title: 'Node releases', url: 'https://nodejs.org/x', startIndex: 0, endIndex: 27 }],
      usedWebSearch: true,
      searchCalls: 1,
    },
  });
  const nodes = [];
  const payload = await makeUseCase(llm, null, web).run({
    question: 'What is the latest Node LTS?',
    threadId: 't-web-direct',
    mode: 'direct',
    webMode: 'auto',
    onNode: (n) => nodes.push(n),
  });

  assert.deepStrictEqual(nodes, ['web_answer']);
  assert.deepStrictEqual(llm.calls, []); // no retrieval, no analyze, no grade
  assert.strictEqual(payload.route, 'web');
  assert.strictEqual(payload.usedWebSearch, true);
  assert.strictEqual(payload.webSearchCount, 1);
  assert.ok(payload.answer.includes('[W1]'), payload.answer);
  assert.strictEqual(payload.sources.length, 1);
  assert.strictEqual(payload.sources[0].sourceType, 'web');
  assert.strictEqual(payload.sources[0].url, 'https://nodejs.org/x');
});

test('direct + web auto: the model declining to search costs one plain call', async () => {
  // The behaviour the whole design exists for: 'auto' must not turn every
  // question into a search.
  const web = new FakeWeb({
    web_answer: { answer: 'A debounce delays a call until input settles.' },
  });
  const payload = await makeUseCase(new FakeLlm({}), null, web).run({
    question: 'What is a debounce?', threadId: 't-web-nosearch', mode: 'direct', webMode: 'auto',
  });

  assert.strictEqual(web.calls.length, 1);
  assert.strictEqual(payload.usedWebSearch, false);
  assert.deepStrictEqual(payload.sources, []);
  assert.ok(!payload.answer.includes('[W'), payload.answer);
});

test('rag + web auto: evidence and web citations arrive together', async () => {
  const llm = new FakeLlm({
    analyze_query: { searchKeywords: ['sqlite'], isAmbiguous: false, ambiguityNote: '' },
    grade_documents: allRelevant,
    generate: { answer: 'SHOULD NOT BE CALLED' },
  });
  const web = new FakeWeb({
    generate_web: {
      answer: 'You chose SQLite [M1]; 3.46 is the current release.',
      citations: [{ title: 'SQLite changes', url: 'https://sqlite.org/c', startIndex: 24, endIndex: 50 }],
      usedWebSearch: true,
      searchCalls: 1,
    },
  });
  const nodes = [];
  const payload = await makeUseCase(llm, new MixedEvidenceSource(), web).run({
    question: 'what database do we use and is it current?',
    threadId: 't-web-rag',
    webMode: 'auto',
    onNode: (n) => nodes.push(n),
  });

  // Retrieval still ran in full; only the terminal changed.
  assert.ok(nodes.includes('analyze_query'));
  assert.ok(nodes.includes('grade_documents'));
  assert.ok(nodes.includes('generate_web'));
  assert.ok(!nodes.includes('generate'));
  assert.ok(!llm.calls.includes('generate'));

  assert.strictEqual(payload.route, 'generate_web');
  const refs = payload.sources.map((x) => x.ref);
  assert.deepStrictEqual(refs, ['M1', 'W1']);
  assert.strictEqual(payload.sources[0].meetingId, 1);
  assert.strictEqual(payload.sources[1].url, 'https://sqlite.org/c');
});

test('rag + web: no evidence after the rewrite loop goes to the web, not to no_data', async () => {
  const llm = new FakeLlm({
    analyze_query: { searchKeywords: ['kubernetes'], isAmbiguous: false, ambiguityNote: '' },
    rewrite_query: { searchKeywords: ['zzzstillnothing'] },
  });
  const web = new FakeWeb({
    generate_web: (req) => {
      // The prompt must admit the records were empty rather than imply it read them.
      assert.ok(req.messages[1].content.includes('(none'), 'expected an empty-evidence prompt');
      return {
        answer: 'Your meetings say nothing about this. The docs recommend X.',
        citations: [{ title: 'Docs', url: 'https://k8s.example', startIndex: 0, endIndex: 44 }],
        usedWebSearch: true,
        searchCalls: 1,
      };
    },
  });
  const payload = await makeUseCase(llm, null, web).run({
    question: 'kubernetes deployment plan?', threadId: 't-web-nodata', webMode: 'auto',
  });

  assert.strictEqual(payload.route, 'generate_web');
  assert.strictEqual(payload.attempts, 3); // the corrective loop still ran first
  assert.deepStrictEqual(payload.sources.map((x) => x.ref), ['W1']);
});

test('web unreachable in auto: degrades to the model alone and says so', async () => {
  const llm = new FakeLlm({
    direct_answer: { answer: 'From my own knowledge.', followUps: [] },
  });
  const web = new FakeWeb({ web_answer: new Error('network down') });
  const payload = await makeUseCase(llm, null, web).run({
    question: 'latest node?', threadId: 't-web-degrade', mode: 'direct', webMode: 'auto',
  });

  assert.strictEqual(payload.answer, 'From my own knowledge.');
  assert.deepStrictEqual(payload.sources, []);
  assert.strictEqual(payload.usedWebSearch, false);
  assert.ok(payload.degradedNote.includes('without the web'), payload.degradedNote);
  assert.deepStrictEqual(llm.calls, ['direct_answer']);
});

test('web unreachable in always: refuses rather than answering unsourced', async () => {
  const llm = new FakeLlm({ direct_answer: { answer: 'SHOULD NOT BE CALLED' } });
  const web = new FakeWeb({ web_answer: new Error('network down') });
  const payload = await makeUseCase(llm, null, web).run({
    question: 'verify this claim', threadId: 't-web-always-fail', mode: 'direct', webMode: 'always',
  });

  assert.ok(payload.answer.includes("couldn't reach the web"), payload.answer);
  assert.deepStrictEqual(llm.calls, []);
  assert.strictEqual(payload.degradedNote, 'Web search unavailable.');
});

test('the configured default applies when a turn does not specify a web mode', async () => {
  // This is where 'auto' actually enters the system in production.
  const web = new FakeWeb({ web_answer: { answer: 'Answered.', usedWebSearch: true, searchCalls: 1 } });
  const payload = await makeUseCase(new FakeLlm({}), null, web, 'auto').run({
    question: 'anything', threadId: 't-web-default', mode: 'direct',
  });

  assert.strictEqual(payload.webMode, 'auto');
  assert.strictEqual(web.calls.length, 1);
});

test('an unrecognised web mode is off, even when the default is auto', async () => {
  const llm = new FakeLlm({ direct_answer: { answer: 'Model only.', followUps: [] } });
  const web = new FakeWeb({ web_answer: { answer: 'SHOULD NOT BE CALLED' } });
  const payload = await makeUseCase(llm, null, web, 'auto').run({
    question: 'anything', threadId: 't-web-typo', mode: 'direct', webMode: 'Auto',
  });

  assert.strictEqual(payload.webMode, 'never');
  assert.deepStrictEqual(web.calls, []);
  assert.deepStrictEqual(llm.calls, ['direct_answer']);
});

test('a thread that omits webMode on a later turn does not inherit the earlier one', async () => {
  // The checkpointer hazard state.js warns about for `mode`: lastWrite
  // ignores an absent value, so without normalization in the use case turn
  // two would silently keep turn one's web mode.
  const llm = new FakeLlm({ direct_answer: { answer: 'Model only.', followUps: [] } });
  const web = new FakeWeb({ web_answer: { answer: 'Searched.', usedWebSearch: true, searchCalls: 1 } });
  const useCase = makeUseCase(llm, null, web); // defaultWebMode 'never'

  const first = await useCase.run({
    question: 'latest node?', threadId: 't-web-sticky', mode: 'direct', webMode: 'auto',
  });
  const second = await useCase.run({
    question: 'and a debounce?', threadId: 't-web-sticky', mode: 'direct',
  });

  assert.strictEqual(first.webMode, 'auto');
  assert.strictEqual(second.webMode, 'never');
  assert.strictEqual(web.calls.length, 1);
});
