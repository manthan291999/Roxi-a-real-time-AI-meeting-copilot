/**
 * Unit tests: SqliteMeetingStore.getAllGlossaryTerms() — cross-meeting
 * dedup by LOWER(term), most-recent-by-time definition (not alphabetic max),
 * and project_id populated only when every contributing meeting shares one
 * project (plan §06). Same fixture-file convention as persistence.test.js:
 * SqliteMeetingStore opens read-only, so a separate writer connection seeds
 * a real temp-file DB per test.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const { SqliteMeetingStore } = require('../src/infrastructure/persistence/SqliteMeetingStore');

/** @returns {{store: SqliteMeetingStore, dbPath: string, cleanup: () => void}} */
function fixture(seed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-glossary-test-'));
  const dbPath = path.join(dir, 'meetings.db');
  const writer = new Database(dbPath);
  writer.exec(`
    CREATE TABLE meetings (id INTEGER PRIMARY KEY, project_id INTEGER);
    CREATE TABLE glossary_terms (
      meeting_id INTEGER NOT NULL,
      term TEXT NOT NULL,
      definition TEXT,
      first_seen DATETIME,
      PRIMARY KEY (meeting_id, term)
    );
  `);
  seed(writer);
  writer.close();

  const store = new SqliteMeetingStore(dbPath);
  return {
    store,
    cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

test('getAllGlossaryTerms', async (t) => {
  await t.test('picks the definition from the most recent meeting by time, not alphabetically', () => {
    const { store, cleanup } = fixture((db) => {
      db.prepare('INSERT INTO meetings (id, project_id) VALUES (?, ?)').run(1, null);
      db.prepare('INSERT INTO meetings (id, project_id) VALUES (?, ?)').run(2, null);
      // Alphabetically "Zzz definition" would win under MAX(definition) even
      // though it is the OLDER of the two — the bug this test guards against.
      db.prepare('INSERT INTO glossary_terms (meeting_id, term, definition, first_seen) VALUES (?, ?, ?, ?)')
        .run(1, 'RRF', 'Zzz definition (older)', '2026-01-01T00:00:00.000Z');
      db.prepare('INSERT INTO glossary_terms (meeting_id, term, definition, first_seen) VALUES (?, ?, ?, ?)')
        .run(2, 'rrf', 'Aaa definition (newer)', '2026-06-01T00:00:00.000Z');
    });

    const [row] = store.getAllGlossaryTerms();
    assert.strictEqual(row.term, 'rrf');
    assert.strictEqual(row.definition, 'Aaa definition (newer)');
    cleanup();
  });

  await t.test('collects every contributing meeting id, deduped case-insensitively', () => {
    const { store, cleanup } = fixture((db) => {
      db.prepare('INSERT INTO meetings (id, project_id) VALUES (?, ?)').run(1, null);
      db.prepare('INSERT INTO meetings (id, project_id) VALUES (?, ?)').run(2, null);
      db.prepare('INSERT INTO glossary_terms (meeting_id, term, definition, first_seen) VALUES (?, ?, ?, ?)')
        .run(1, 'RRF', 'def one', '2026-01-01T00:00:00.000Z');
      db.prepare('INSERT INTO glossary_terms (meeting_id, term, definition, first_seen) VALUES (?, ?, ?, ?)')
        .run(2, 'Rrf', 'def two', '2026-02-01T00:00:00.000Z');
    });

    const rows = store.getAllGlossaryTerms();
    assert.strictEqual(rows.length, 1);
    assert.deepStrictEqual(rows[0].meeting_ids.sort(), [1, 2]);
    cleanup();
  });

  await t.test('project_id is populated when every contributing meeting shares one project', () => {
    const { store, cleanup } = fixture((db) => {
      db.prepare('INSERT INTO meetings (id, project_id) VALUES (?, ?)').run(1, 5);
      db.prepare('INSERT INTO meetings (id, project_id) VALUES (?, ?)').run(2, 5);
      db.prepare('INSERT INTO glossary_terms (meeting_id, term, definition, first_seen) VALUES (?, ?, ?, ?)')
        .run(1, 'sprint', 'a fixed iteration', '2026-01-01T00:00:00.000Z');
      db.prepare('INSERT INTO glossary_terms (meeting_id, term, definition, first_seen) VALUES (?, ?, ?, ?)')
        .run(2, 'sprint', 'a fixed iteration, refined', '2026-02-01T00:00:00.000Z');
    });

    const [row] = store.getAllGlossaryTerms();
    assert.strictEqual(row.project_id, 5);
    cleanup();
  });

  await t.test('project_id is null when contributing meetings do not share one project', () => {
    const { store, cleanup } = fixture((db) => {
      db.prepare('INSERT INTO meetings (id, project_id) VALUES (?, ?)').run(1, 5);
      db.prepare('INSERT INTO meetings (id, project_id) VALUES (?, ?)').run(2, 9);
      db.prepare('INSERT INTO glossary_terms (meeting_id, term, definition, first_seen) VALUES (?, ?, ?, ?)')
        .run(1, 'standup', 'daily sync', '2026-01-01T00:00:00.000Z');
      db.prepare('INSERT INTO glossary_terms (meeting_id, term, definition, first_seen) VALUES (?, ?, ?, ?)')
        .run(2, 'standup', 'daily sync, cross-project', '2026-02-01T00:00:00.000Z');
    });

    const [row] = store.getAllGlossaryTerms();
    assert.strictEqual(row.project_id, null);
    cleanup();
  });

  await t.test('project_id is null when even one contributing meeting has no project', () => {
    const { store, cleanup } = fixture((db) => {
      db.prepare('INSERT INTO meetings (id, project_id) VALUES (?, ?)').run(1, 5);
      db.prepare('INSERT INTO meetings (id, project_id) VALUES (?, ?)').run(2, null);
      db.prepare('INSERT INTO glossary_terms (meeting_id, term, definition, first_seen) VALUES (?, ?, ?, ?)')
        .run(1, 'kickoff', 'first meeting on a project', '2026-01-01T00:00:00.000Z');
      db.prepare('INSERT INTO glossary_terms (meeting_id, term, definition, first_seen) VALUES (?, ?, ?, ?)')
        .run(2, 'kickoff', 'first meeting, unscoped mention', '2026-02-01T00:00:00.000Z');
    });

    const [row] = store.getAllGlossaryTerms();
    assert.strictEqual(row.project_id, null);
    cleanup();
  });

  await t.test('blank/null definitions are excluded, matching the previous behaviour', () => {
    const { store, cleanup } = fixture((db) => {
      db.prepare('INSERT INTO meetings (id, project_id) VALUES (?, ?)').run(1, null);
      db.prepare('INSERT INTO glossary_terms (meeting_id, term, definition, first_seen) VALUES (?, ?, ?, ?)')
        .run(1, 'empty', '   ', '2026-01-01T00:00:00.000Z');
    });

    assert.deepStrictEqual(store.getAllGlossaryTerms(), []);
    cleanup();
  });

  await t.test('returns [] when the glossary_terms table does not exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-glossary-test-'));
    const dbPath = path.join(dir, 'meetings.db');
    const writer = new Database(dbPath);
    writer.exec('CREATE TABLE meetings (id INTEGER PRIMARY KEY, project_id INTEGER)');
    writer.close();

    const store = new SqliteMeetingStore(dbPath);
    assert.deepStrictEqual(store.getAllGlossaryTerms(), []);
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
