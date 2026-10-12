/**
 * Repository tests against an in-memory database.
 *
 * These were impossible before db/index.js was split: it was a singleton module
 * holding its own connection at a hardcoded path, so there was no way to open a
 * throwaway database or to run two meetings in one process. Being able to write
 * this file at all is the evidence that the coupling is gone.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startSession } = require('../db/index.js');
const { SpeakerRepository } = require('../db/speaker-repository.js');
const { open } = require('../db/connection.js');

const session = () => startSession(':memory:', 'quarterly planning');
const CTRL = String.fromCharCode(1); // a C0 control char the sanitizer must strip

test('startSession creates a meeting row carrying its context', () => {
  const s = session();
  const row = s.db.prepare('SELECT context, status FROM meetings WHERE id = ?').get(s.meetingId);
  assert.strictEqual(row.context, 'quarterly planning');
  assert.strictEqual(row.status, 'running');
  s.close('', 'ended');
});

test('two sessions can be open at once', () => {
  // The old singleton held one module-level meeting id, so this could not work.
  const a = startSession(':memory:', 'meeting A');
  const b = startSession(':memory:', 'meeting B');
  assert.notStrictEqual(a.db, b.db);
  a.transcripts.save('Alice', 'first meeting line');
  b.transcripts.save('Bob', 'second meeting line');
  a.transcripts.flush();
  b.transcripts.flush();
  assert.strictEqual(a.db.prepare('SELECT COUNT(*) c FROM transcripts').get().c, 1);
  assert.strictEqual(b.db.prepare('SELECT COUNT(*) c FROM transcripts').get().c, 1);
  a.close('', 'ended');
  b.close('', 'ended');
});

test('closing flushes pending transcripts (regression)', () => {
  // The previous implementation set `closed = true` before calling flushBatches(),
  // whose first line returned early when `closed` -- so the final batch was
  // silently discarded on every single meeting.
  const s = session();
  s.transcripts.save('Alice', 'the last thing anybody said');
  assert.strictEqual(
    s.db.prepare('SELECT COUNT(*) c FROM transcripts').get().c,
    0,
    'not yet flushed'
  );

  const db = s.db;
  s.transcripts.close();
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) c FROM transcripts').get().c,
    1,
    'the final batch must survive shutdown'
  );
});

test('transcripts are sanitized and defaulted', () => {
  const s = session();
  s.transcripts.save(null, 'text with a ' + CTRL + ' control char');
  s.transcripts.save('Alice', '   ');  // whitespace only -> dropped
  s.transcripts.save('Bob', null);     // non-string -> dropped
  s.transcripts.flush();
  const rows = s.db.prepare('SELECT speaker, text FROM transcripts').all();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].speaker, 'Speaker', 'missing speaker gets a default');
  assert.strictEqual(rows[0].text.includes(CTRL), false, 'control chars stripped');
  s.close('', 'ended');
});

test('saveAnalyzedChunk persists the chunk and its artifacts atomically', () => {
  const s = session();
  const chunkId = s.artifacts.saveAnalyzedChunk(
    {
      seq: 0,
      speaker: 'Alice',
      text: 'we will ship on friday',
      significance: 'high',
      topic: 'release',
    },
    {
      decisions: [{ text: 'ship on friday', confidence: 0.9 }],
      actionItems: [{ text: 'cut the release branch', assignee: 'Bob', deadline: 'thursday' }],
      risks: [{ text: 'QA has no time', category: 'TIMELINE', severity: 'high' }],
    }
  );

  assert.ok(chunkId > 0);
  const decision = s.db.prepare('SELECT * FROM decisions WHERE meeting_id = ?').get(s.meetingId);
  assert.strictEqual(decision.description, 'ship on friday');
  assert.strictEqual(decision.chunk_id, chunkId, 'artifacts reference their chunk');
  assert.strictEqual(decision.confidence, 0.9);

  const action = s.db.prepare('SELECT * FROM action_items WHERE meeting_id = ?').get(s.meetingId);
  assert.strictEqual(action.assignee, 'Bob');
  assert.strictEqual(action.deadline, 'thursday');

  const risk = s.db.prepare('SELECT * FROM risks WHERE meeting_id = ?').get(s.meetingId);
  assert.strictEqual(risk.severity, 'high');
  assert.strictEqual(risk.chunk_id, chunkId);
  s.close('', 'ended');
});

test('getAggregates reflects what was written', () => {
  const s = session();
  s.artifacts.saveAnalyzedChunk(
    {
      seq: 0,
      speaker: 'Alice',
      text: 'a decision was made',
      significance: 'high',
      topic: 'release',
    },
    { decisions: [{ text: 'ship on friday', confidence: null }], actionItems: [], risks: [] }
  );
  s.artifacts.upsertSpeakerProfile('Alice', 'release', 'high');

  const agg = s.artifacts.getAggregates();
  assert.deepStrictEqual(agg.decisions, ['ship on friday']);
  assert.strictEqual(agg.chunkCount, 1);
  assert.strictEqual(agg.topic, 'release');
  assert.strictEqual(agg.speakers[0].speaker, 'Alice');
  s.close('', 'ended');
});

test('speaker names and embeddings round-trip', () => {
  // Identity is deliberately meeting-independent: names and voices outlive the
  // meeting they were first seen in.
  const { db } = open(':memory:');
  const repo = new SpeakerRepository(db);

  repo.saveSpeakerName('Speaker A', 'Alice');
  assert.strictEqual(repo.getSpeakerName('Speaker A'), 'Alice');
  assert.strictEqual(repo.getSpeakerName('Speaker Z'), null);

  repo.saveSpeakerName('Speaker A', 'Alice Cooper'); // upsert, not duplicate
  assert.strictEqual(repo.getSpeakerName('Speaker A'), 'Alice Cooper');

  repo.saveSpeakerEmbedding('Speaker A', 'Alice Cooper', [0.1, 0.2, 0.3]);
  const all = repo.getAllSpeakerEmbeddings();
  assert.strictEqual(all.length, 1);
  assert.deepStrictEqual(JSON.parse(all[0].embedding_json), [0.1, 0.2, 0.3]);
  db.close();
});

test('meeting end records status and summary', () => {
  const s = session();
  s.meetings.end('# Summary', 'aborted', 'fallback_template');
  const row = s.db.prepare('SELECT status, summary FROM meetings WHERE id = ?').get(s.meetingId);
  assert.strictEqual(row.status, 'aborted');
  assert.strictEqual(row.summary, '# Summary');
  const summaryRow = s.db
    .prepare('SELECT kind FROM summaries WHERE meeting_id = ?')
    .get(s.meetingId);
  assert.strictEqual(summaryRow.kind, 'fallback_template');
  s.db.close();
});

test('repositories never throw on bad input', () => {
  const s = session();
  assert.doesNotThrow(() => {
    s.artifacts.saveAnalyzedChunk({ seq: 0, speaker: null, text: null }, null);
    s.artifacts.upsertGlossary(null);
    s.artifacts.upsertSpeakerProfile(null, null, null);
    s.artifacts.saveSuggestedReply(undefined);
    s.transcripts.save(undefined, undefined);
  });
  s.close('', 'ended');
});

test('a meeting records the account that owns it, or none in local-only mode', () => {
  const owned = startSession(':memory:', 'ctx', {}, null, 'Owned', 'user-123');
  assert.strictEqual(owned.db.prepare('SELECT account_id FROM meetings WHERE id = ?').get(owned.meetingId).account_id, 'user-123');
  owned.close('', 'ended');

  const local = startSession(':memory:', 'ctx');
  assert.strictEqual(local.db.prepare('SELECT account_id FROM meetings WHERE id = ?').get(local.meetingId).account_id, null);
  local.close('', 'ended');
});

test('M011 tolerates an owner column the Rust host already added', () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../db/migrate.js');
  const db = new Database(':memory:');
  // A database at v10 whose meetings table Rust has already given account_id.
  const { db: seeded } = open(':memory:');
  db.exec(seeded.prepare("SELECT group_concat(sql, ';') AS s FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_version'").get().s);
  db.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP, description TEXT)');
  db.prepare('INSERT INTO schema_version (version, description) VALUES (10, ?)').run('seeded');
  assert.ok(db.prepare('PRAGMA table_info(meetings)').all().some((c) => c.name === 'account_id'));

  assert.strictEqual(runMigrations(db), 11);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_meetings_account'").get());
});
