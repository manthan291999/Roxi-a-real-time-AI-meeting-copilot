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

function makeUseCase(llm, evidenceSource = null) {
  const graph = buildChatGraph({
    analyzeQuery: createAnalyzeQueryNode({ llm, logger: silentLogger }),
    retrieve: createRetrieveNode({
      evidenceSource: evidenceSource || new FtsEvidenceSource(retriever),
      logger: silentLogger,
    }),
    gradeDocuments: createGradeDocumentsNode({ llm, logger: silentLogger }),
    rewriteQuery: createRewriteQueryNode({ llm, logger: silentLogger }),
    clarify: createClarifyNode({ llm, logger: silentLogger }),
    generate: createGenerateNode({ llm, logger: silentLogger }),
    respondNoData: createRespondNoDataNode({ logger: silentLogger, retriever }),
  });
  return new AnswerQuestionUseCase({ graph, logger: silentLogger });
}


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
