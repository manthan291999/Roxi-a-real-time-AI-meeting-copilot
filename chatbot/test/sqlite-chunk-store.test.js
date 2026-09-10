/**
 * Unit tests: SqliteChunkStore against ':memory:' — no network, real SQL.
 * Same convention as document-repository.test.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const { SqliteChunkStore } = require('../src/infrastructure/persistence/SqliteChunkStore');

/** Minimal real schema — just the columns SqliteChunkStore's queries touch. */
function seededStore() {
  // SqliteChunkStore opens its own connection by path; ':memory:' databases
  // are per-connection, so seed through the SAME instance's connection by
  // opening it first and reaching in via _open(), the same seam
  // document-repository.test.js uses for its own store.
  const store = new SqliteChunkStore(':memory:');
  const db = store._open();
  db.exec(`
    CREATE TABLE meetings (id INTEGER PRIMARY KEY, start_time TEXT, context TEXT, project_id INTEGER, display_id TEXT);
    CREATE TABLE chunks (id INTEGER PRIMARY KEY, meeting_id INTEGER, seq INTEGER, speaker TEXT, text TEXT, significance TEXT, topic TEXT, created_at TEXT);
    CREATE TABLE decisions (id INTEGER PRIMARY KEY, chunk_id INTEGER);
    CREATE TABLE action_items (id INTEGER PRIMARY KEY, chunk_id INTEGER);
    CREATE TABLE risks (id INTEGER PRIMARY KEY, chunk_id INTEGER);
  `);
  db.prepare(
    'INSERT INTO meetings (id, start_time, context, project_id, display_id) VALUES (?, ?, ?, ?, ?)'
  ).run(1, '2026-08-20T09:55:00.000Z', 'Weekly planning', 5, 'ROXI-001');

  const insertChunk = db.prepare(
    'INSERT INTO chunks (id, meeting_id, seq, speaker, text, significance, topic, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insertChunk.run(1, 1, 0, 'Speaker A', 'we decided to ship Friday', 'high', 'release', '2026-08-20T10:00:00.000Z');
  insertChunk.run(2, 1, 1, 'Speaker B', 'sounds good to me', 'low', null, '2026-08-20T10:01:00.000Z');
  insertChunk.run(3, 1, 2, '', '   ', null, null, '2026-08-20T10:02:00.000Z'); // blank text — must be excluded

  db.prepare('INSERT INTO decisions (id, chunk_id) VALUES (?, ?)').run(11, 1);
  db.prepare('INSERT INTO action_items (id, chunk_id) VALUES (?, ?)').run(21, 1);
  db.prepare('INSERT INTO action_items (id, chunk_id) VALUES (?, ?)').run(22, 1);
  db.prepare('INSERT INTO risks (id, chunk_id) VALUES (?, ?)').run(31, 2);

  return store;
}

test('SqliteChunkStore.chunksSince', async (t) => {
  await t.test('returns only chunks after the given id, ordered by id', () => {
    const rows = seededStore().chunksSince(0);
    assert.deepStrictEqual(rows.map((r) => r.id), [1, 2]);
  });

  await t.test('excludes chunks with null/blank text', () => {
    const rows = seededStore().chunksSince(0);
    assert.ok(!rows.some((r) => r.id === 3));
  });

  await t.test('joins meeting fields onto each chunk', () => {
    const [first] = seededStore().chunksSince(0);
    assert.strictEqual(first.meetingId, 1);
    assert.strictEqual(first.projectId, 5);
    assert.strictEqual(first.displayId, 'ROXI-001');
    assert.strictEqual(first.meetingContext, 'Weekly planning');
    assert.strictEqual(first.meetingStartTime, '2026-08-20T09:55:00.000Z');
  });

  await t.test('attaches linked decision/risk/action-item ids per chunk', () => {
    const rows = seededStore().chunksSince(0);
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.deepStrictEqual(byId.get(1).linkedDecisionIds, [11]);
    assert.deepStrictEqual(byId.get(1).linkedActionItemIds, [21, 22]);
    assert.deepStrictEqual(byId.get(1).linkedRiskIds, []);
    assert.deepStrictEqual(byId.get(2).linkedRiskIds, [31]);
    assert.deepStrictEqual(byId.get(2).linkedDecisionIds, []);
  });

  await t.test('a high-water mark past every chunk returns nothing', () => {
    const rows = seededStore().chunksSince(999);
    assert.deepStrictEqual(rows, []);
  });
});

test('SqliteChunkStore.chunksByIds', async (t) => {
  await t.test('returns exactly the requested chunks', () => {
    const rows = seededStore().chunksByIds([2]);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].id, 2);
  });

  await t.test('an empty id list is a no-op, not a query error', () => {
    assert.deepStrictEqual(seededStore().chunksByIds([]), []);
  });
});
