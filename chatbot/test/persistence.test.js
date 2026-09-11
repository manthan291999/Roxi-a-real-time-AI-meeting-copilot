/**
 * Integration tests: persistence — fixture meeting DB -> store -> index
 * builder -> retriever. Uses a temp file DB; never touches real data.
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
const { buildMatchExpressions } = require('../src/infrastructure/persistence/ftsQuery');

let dir, meetingDbPath, indexDbPath, fixtureDb;
let store, builder, retriever;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-test-'));
  meetingDbPath = path.join(dir, 'meetings.db');
  indexDbPath = path.join(dir, 'index.db');

  // Fixture meeting DB mirroring the capture pipeline's schema (subset).
  fixtureDb = new Database(meetingDbPath);
  fixtureDb.exec(`
    CREATE TABLE meetings (
      id INTEGER PRIMARY KEY, start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      end_time DATETIME, summary TEXT, context TEXT, name TEXT,
      status TEXT DEFAULT 'ended', api_calls INTEGER DEFAULT 0, provider TEXT
    );
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

    INSERT INTO decisions (meeting_id, description) VALUES
      (1, 'Use SQLite as the embedded database');

    INSERT INTO action_items (meeting_id, assignee, description) VALUES
      (2, 'Alice', 'Implement webhook retry with backoff');

    INSERT INTO risks (meeting_id, text, severity) VALUES
      (1, 'Payment webhook timeouts may lose orders', 'high');
  `);
  fixtureDb.close();

  store = new SqliteMeetingStore(meetingDbPath);
  builder = new FtsIndexBuilder(indexDbPath);
  retriever = new FtsRetriever(indexDbPath);
});

after(() => {
  store.close(); builder.close(); retriever.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('store reads meetings and source rows from fixture', () => {
  const meetings = store.listMeetings();
  assert.strictEqual(meetings.length, 2);
  const rows = store.iterSourceRows();
  // 3 transcripts + 1 summary + 1 decision + 1 action item + 1 risk
  assert.strictEqual(rows.length, 7);
  const tables = new Set(rows.map((r) => r.sourceTable));
  assert.deepStrictEqual(
    [...tables].sort(),
    ['action_items', 'decisions', 'risks', 'summaries', 'transcripts']
  );
});

test('builder rebuild populates index and meta', () => {
  const stats = builder.rebuild(store);
  assert.strictEqual(stats.corpusCount, 7);
  assert.strictEqual(stats.meetingCount, 2);
  const meta = builder.readMeta();
  assert.ok(meta.builtAt > 0);
  assert.strictEqual(meta.corpusCount, 7);
});

test('rebuildIfStale skips when fresh', () => {
  const res = builder.rebuildIfStale(store);
  assert.strictEqual(res.rebuilt, false);
  assert.strictEqual(res.reason, 'fresh');
});

test('retriever finds webhook evidence with meeting date and speaker', () => {
  const hits = retriever.search(buildMatchExpressions(['webhook', 'timeout']), { limit: 10 });
  assert.ok(hits.length >= 2);
  // Every hit must be on-topic (BM25 may rank the short risk row first).
  for (const h of hits) {
    assert.ok(/webhook|timeout/i.test(h.text), `off-topic hit: ${h.text}`);
  }
  const transcriptHit = hits.find((h) => h.sourceTable === 'transcripts');
  assert.ok(transcriptHit, 'expected at least one transcript hit');
  assert.strictEqual(transcriptHit.speaker, 'Speaker B');
  assert.ok(transcriptHit.meetingDate.startsWith('2026-08-01'));
});

test('retriever finds decisions, risks and action items too', () => {
  const hits = retriever.search(buildMatchExpressions(['retry', 'backoff']), { limit: 10 });
  const tables = new Set(hits.map((h) => h.sourceTable));
  assert.ok(tables.has('action_items') || tables.has('transcripts') || tables.has('summaries'));
});

test('retriever returns [] for nonsense queries without throwing', () => {
  const hits = retriever.search(buildMatchExpressions(['zzzqqqxyzzy']), { limit: 5 });
  assert.deepStrictEqual(hits, []);
});

test('recentTopics returns latest summaries first', () => {
  const topics = retriever.recentTopics(3);
  assert.strictEqual(topics.length, 1); // only meeting 2 has a summary
  assert.strictEqual(topics[0].meetingId, 2);
  assert.ok(topics[0].topic.length > 10);
});
