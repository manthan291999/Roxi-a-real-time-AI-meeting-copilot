/**
 * Unit/integration tests: CorpusProbe implementations.
 *
 * FtsCorpusProbe against a real, fixture-built FTS index (same style as
 * persistence.test.js — temp file DB, never touches real data).
 * PermissiveCorpusProbe is pure and needs no fixture.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const { SqliteMeetingStore } = require('../src/infrastructure/persistence/SqliteMeetingStore');
const { FtsIndexBuilder } = require('../src/infrastructure/persistence/FtsIndexBuilder');
const { FtsCorpusProbe } = require('../src/infrastructure/persistence/FtsCorpusProbe');
const { PermissiveCorpusProbe } = require('../src/infrastructure/persistence/PermissiveCorpusProbe');

let dir, meetingDbPath, indexDbPath;
let store, builder, probe;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-corpus-probe-test-'));
  meetingDbPath = path.join(dir, 'meetings.db');
  indexDbPath = path.join(dir, 'index.db');

  const fixtureDb = new Database(meetingDbPath);
  fixtureDb.exec(`
    CREATE TABLE meetings (id INTEGER PRIMARY KEY, start_time DATETIME, end_time DATETIME, summary TEXT, context TEXT, name TEXT, status TEXT DEFAULT 'ended', api_calls INTEGER DEFAULT 0, provider TEXT);
    CREATE TABLE transcripts (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER, speaker TEXT, text TEXT);
    CREATE TABLE summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER, kind TEXT, text TEXT);
    CREATE TABLE decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER, description TEXT, confidence REAL, chunk_id INTEGER);
    CREATE TABLE action_items (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER, assignee TEXT, description TEXT, deadline TEXT, chunk_id INTEGER);
    CREATE TABLE risks (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER, chunk_id INTEGER, text TEXT, category TEXT, severity TEXT);

    INSERT INTO meetings (id, start_time, status) VALUES (1, '2026-08-01 10:00:00', 'ended');
    INSERT INTO transcripts (meeting_id, speaker, text) VALUES
      (1, 'Speaker A', 'We decided to use SQLite for the local database'),
      (1, 'Speaker B', 'The payment webhook keeps timing out in production'),
      (1, 'Speaker A', 'krishaweb owns the deployment pipeline');
  `);
  fixtureDb.close();

  store = new SqliteMeetingStore(meetingDbPath);
  builder = new FtsIndexBuilder(indexDbPath);
  builder.rebuild(store);

  probe = new FtsCorpusProbe(indexDbPath);
});

after(() => {
  probe.close();
  store.close();
  builder.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a term that appears in the indexed transcripts is found', () => {
  assert.strictEqual(probe.has('webhook'), true);
  assert.strictEqual(probe.has('sqlite'), true);
  assert.strictEqual(probe.has('krishaweb'), true);
});

test('TOKENIZER — porter stemming means a plural/inflected query still matches', () => {
  // The index holds "keeps timing out" and "decided" — chat_fts is built
  // with `tokenize = 'porter unicode61'` (FtsIndexBuilder.js), so the plain
  // MATCH below is stemmed the same way the indexed content was, without
  // this file hand-rolling stemming (see this class's own header comment).
  assert.strictEqual(probe.has('timings'), true); // stems to "time"/"timing"
  assert.strictEqual(probe.has('deciding'), true); // stems to "decid"
});

test('a term genuinely absent from the corpus is not found', () => {
  assert.strictEqual(probe.has('hbvxvsjhvbcjhvjbcx'), false);
  assert.strictEqual(probe.has('kubernetes'), false);
});

test('case is not significant', () => {
  assert.strictEqual(probe.has('WEBHOOK'), true);
  assert.strictEqual(probe.has('Webhook'), true);
});

test('an FTS5-special character in the term does not throw — sanitized like any other query', () => {
  assert.doesNotThrow(() => probe.has('webhook*'));
  assert.doesNotThrow(() => probe.has('"webhook'));
  assert.doesNotThrow(() => probe.has('web(hook)'));
});

test('an empty or punctuation-only term is found (nothing to search, do not accuse)', () => {
  assert.strictEqual(probe.has(''), true);
  assert.strictEqual(probe.has('***'), true);
});

test('FAILS OPEN — a missing index file resolves to true, not a throw', () => {
  const missing = new FtsCorpusProbe(path.join(dir, 'does-not-exist.db'));
  assert.doesNotThrow(() => {
    assert.strictEqual(missing.has('anything'), true);
  });
  missing.close();
});

test('FAILS OPEN — a corrupt/non-database file resolves to true, not a throw', () => {
  const corruptPath = path.join(dir, 'corrupt.db');
  fs.writeFileSync(corruptPath, 'not a sqlite database');
  const corrupt = new FtsCorpusProbe(corruptPath);
  assert.doesNotThrow(() => {
    assert.strictEqual(corrupt.has('anything'), true);
  });
  corrupt.close();
});

test('close() is safe to call before open() and more than once', () => {
  const fresh = new FtsCorpusProbe(indexDbPath);
  assert.doesNotThrow(() => fresh.close());
  assert.doesNotThrow(() => fresh.close());
});

test('PermissiveCorpusProbe always finds the term, regardless of what it is', () => {
  const permissive = new PermissiveCorpusProbe();
  assert.strictEqual(permissive.has('anything'), true);
  assert.strictEqual(permissive.has('hbvxvsjhvbcjhvjbcx'), true);
  assert.strictEqual(permissive.has(''), true);
  assert.strictEqual(permissive.has(undefined), true);
});
