'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const { resolveMeetingScope, allowedMeetingIds } = require('../src/application/meetingScope');
const { FtsRetriever } = require('../src/infrastructure/persistence/FtsRetriever');
const { toQdrantFilter } = require('../src/infrastructure/vectorstore/QdrantVectorIndex');

const owners = { meetingIdsOwnedBy: (id) => (id === 'admin' ? [1, 2] : []) };

test('resolves the host scope, failing closed on anything unknown', () => {
  assert.deepStrictEqual(resolveMeetingScope(undefined, owners), { all: true, ids: [] });
  assert.deepStrictEqual(resolveMeetingScope({ kind: 'everyone' }, owners), { all: true, ids: [] });
  assert.deepStrictEqual(resolveMeetingScope({ kind: 'account', accountId: 'admin' }, owners), { all: false, ids: [1, 2] });
  assert.deepStrictEqual(resolveMeetingScope({ kind: 'account', accountId: 'new' }, owners), { all: false, ids: [] });
  assert.deepStrictEqual(resolveMeetingScope({ kind: 'nobody' }, owners), { all: false, ids: [] });
  assert.deepStrictEqual(resolveMeetingScope({ kind: 'account' }, owners), { all: false, ids: [] });
  assert.deepStrictEqual(resolveMeetingScope({ kind: 'bogus' }, owners), { all: false, ids: [] });
  assert.strictEqual(allowedMeetingIds({ all: true, ids: [] }), null);
  assert.deepStrictEqual(allowedMeetingIds({ all: false, ids: [2] }), [2]);
});

test('lexical search and recent topics return only allowed meetings', () => {
  const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'roxi-scope-'));
  const path = require('node:path').join(dir, 'index.db');
  const db = new Database(path);
  db.exec(`
    CREATE TABLE meetings_ref (id INTEGER PRIMARY KEY, start_time TEXT, status TEXT, context TEXT, name TEXT);
    CREATE VIRTUAL TABLE chat_fts USING fts5(source_table UNINDEXED, source_id UNINDEXED, meeting_id UNINDEXED, speaker, text);
    INSERT INTO meetings_ref VALUES (1, '2026-09-01', 'ended', '', 'Admin budget'), (9, '2026-09-02', 'ended', '', 'Other budget');
    INSERT INTO chat_fts VALUES ('transcripts', 1, 1, 'A', 'the budget is approved'), ('transcripts', 2, 9, 'B', 'the budget is secret');
    INSERT INTO chat_fts VALUES ('summaries', 3, 1, '', 'Admin summary'), ('summaries', 4, 9, '', 'Other summary');
  `);
  db.close();

  const retriever = new FtsRetriever(path);
  assert.strictEqual(retriever.search(['budget']).length, 2, 'unrestricted sees both');
  assert.deepStrictEqual(retriever.search(['budget'], { meetingIds: [1] }).map((h) => h.meetingId), [1]);
  assert.deepStrictEqual(retriever.search(['budget'], { meetingIds: [] }), []);
  assert.deepStrictEqual(retriever.recentTopics(5, { meetingIds: [1] }).map((t) => t.meetingId), [1]);
  assert.deepStrictEqual(retriever.recentTopics(5, { meetingIds: [] }), []);
  retriever.close();
});

test('the Qdrant filter scopes by meeting as well as by project', () => {
  assert.strictEqual(toQdrantFilter({}), null);
  assert.strictEqual(toQdrantFilter({ projectId: null, meetingIds: null }), null);
  assert.deepStrictEqual(toQdrantFilter({ meetingIds: [1, 2] }), { must: [{ key: 'meeting_id', match: { any: [1, 2] } }] });
  assert.deepStrictEqual(toQdrantFilter({ projectId: 7, meetingIds: [1], meetingIdsKey: 'meeting_ids' }), {
    must: [{ key: 'project_id', match: { value: 7 } }, { key: 'meeting_ids', match: { any: [1] } }],
  });
});
