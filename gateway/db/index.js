/**
 * AI Meeting Interpreter — Persistence Layer (better-sqlite3)
 *
 * - Base tables are created idempotently; schema evolution goes through the
 *   forward-only migration runner (migrate.js). Extend-only: never rename or
 *   drop tables/columns (the Rust read path in src-tauri/src/db.rs depends on
 *   the existing shape).
 * - High-volume transcripts stay on the 5s batch flush; low-frequency
 *   per-chunk artifacts (chunks, risks, speaker profiles, glossary) are
 *   written immediately so a crash loses at most the in-flight chunk.
 * - Every save* sanitizes input via validate.js and never throws — a DB
 *   failure must not kill the live pipeline.
 */

const Database = require('better-sqlite3');
const path = require('path');
const { runMigrations } = require('./migrate.js');
const { sanitizeText } = require('../infrastructure/validate.js');
const { log } = require('../infrastructure/logger.js');

const MAX_SPEAKER_TOPICS = 10;

let db = null;
let currentMeetingId = null;
let closed = false;

// Batch arrays (high-volume path)
let transcriptBatch = [];
let batchTimer = null;

// Prepared statements (lazily built after init)
let stmts = null;

function prepareStatements() {
  stmts = {
    insertTranscript: db.prepare('INSERT INTO transcripts (meeting_id, speaker, text) VALUES (?, ?, ?)'),
    insertChunk: db.prepare(
      'INSERT INTO chunks (meeting_id, seq, speaker, text, significance, topic) VALUES (?, ?, ?, ?, ?, ?)'
    ),
    insertRisk: db.prepare(
      'INSERT INTO risks (meeting_id, chunk_id, text, category, severity) VALUES (?, ?, ?, ?, ?)'
    ),
    upsertSpeaker: db.prepare(`
      INSERT INTO speaker_profiles (meeting_id, speaker, chunk_count, topics, last_seen)
      VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (meeting_id, speaker) DO UPDATE SET
        chunk_count = chunk_count + 1,
        topics = excluded.topics,
        last_seen = CURRENT_TIMESTAMP
    `),
    getSpeaker: db.prepare('SELECT topics FROM speaker_profiles WHERE meeting_id = ? AND speaker = ?'),
    upsertGlossary: db.prepare(`
      INSERT INTO glossary_terms (meeting_id, term, definition)
      VALUES (?, ?, ?)
      ON CONFLICT (meeting_id, term) DO UPDATE SET definition = excluded.definition
    `),
    incrementApiCalls: db.prepare('UPDATE meetings SET api_calls = api_calls + ? WHERE id = ?'),
    insertDecision: db.prepare(
      'INSERT INTO decisions (meeting_id, description, confidence, chunk_id) VALUES (?, ?, ?, ?)'
    ),
    insertActionItem: db.prepare(
      'INSERT INTO action_items (meeting_id, assignee, description, deadline, chunk_id) VALUES (?, ?, ?, ?, ?)'
    ),
    insertAnalysis: db.prepare('INSERT INTO technical_analyses (meeting_id, description) VALUES (?, ?)'),
    insertReply: db.prepare('INSERT INTO suggested_replies (meeting_id, text) VALUES (?, ?)'),
    insertSummary: db.prepare('INSERT INTO summaries (meeting_id, kind, text) VALUES (?, ?, ?)'),
    endMeeting: db.prepare(
      'UPDATE meetings SET summary = ?, end_time = CURRENT_TIMESTAMP, status = ? WHERE id = ?'
    ),
  };
}

/**
 * Open the DB, apply pragmas + base schema + migrations, create the meeting
 * row. Throws on failure — the sidecar must surface this as an Error event.
 * @param {string} [meetingContext] user-supplied meeting briefing
 */
async function initDB(meetingContext = '') {
  const dbPath = path.join(__dirname, '..', 'meeting_history.db');
  db = new Database(dbPath);

  // WAL lets the Rust read path (db.rs) query while we write.
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  // Base tables (fresh-DB bootstrap; migrations handle existing DBs).
  db.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      summary TEXT
    );

    CREATE TABLE IF NOT EXISTS transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER REFERENCES meetings(id),
      speaker TEXT,
      text TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER REFERENCES meetings(id),
      description TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS action_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER REFERENCES meetings(id),
      assignee TEXT,
      description TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS technical_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER REFERENCES meetings(id),
      description TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS suggested_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER REFERENCES meetings(id),
      text TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS speaker_names (
      stt_label   TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS speaker_embeddings (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      stt_label    TEXT NOT NULL,
      display_name TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const schemaVersion = runMigrations(db);
  prepareStatements();

  const context = sanitizeText(meetingContext, 2000);
  const info = db.prepare('INSERT INTO meetings (context) VALUES (?)').run(context || null);
  currentMeetingId = info.lastInsertRowid;
  log('info', 'db', 'meeting_started', { meetingId: currentMeetingId, schemaVersion });

  // Start batch flusher (unref so it never blocks process exit).
  batchTimer = setInterval(flushBatches, 5000);
  if (batchTimer.unref) batchTimer.unref();
}

function flushBatches() {
  if (!db || !currentMeetingId || closed) return;

  if (transcriptBatch.length > 0) {
    const items = [...transcriptBatch];
    transcriptBatch = [];
    try {
      const insertMany = db.transaction((rows) => {
        for (const item of rows) stmts.insertTranscript.run(currentMeetingId, item.speaker, item.text);
      });
      insertMany(items);
    } catch (err) {
      log('error', 'db', 'transcript_flush_failed', { count: items.length, message: err.message });
    }
  }
}

// --- High-volume batched path ------------------------------------------------

function saveTranscript(speaker, text) {
  const cleanText = sanitizeText(text, 5000);
  if (!cleanText) return;
  transcriptBatch.push({ speaker: sanitizeText(speaker, 100) || 'Speaker', text: cleanText });
}

// --- Per-chunk immediate path (crash-safe incremental persistence) -----------

/**
 * Persist an analyzed chunk. Returns the chunk row id, or null on failure.
 */
function saveChunk({ seq, speaker, text, significance, topic }) {
  if (!db || !currentMeetingId || closed) return null;
  const cleanText = sanitizeText(text, 10000);
  if (!cleanText) return null;
  try {
    const info = stmts.insertChunk.run(
      currentMeetingId,
      seq,
      sanitizeText(speaker, 100) || 'Speaker',
      cleanText,
      sanitizeText(significance, 20),
      sanitizeText(topic, 200)
    );
    return info.lastInsertRowid;
  } catch (err) {
    log('error', 'db', 'save_chunk_failed', { seq, message: err.message });
    return null;
  }
}

/** Persist risks detected in a chunk. */
function saveRisks(chunkId, risks) {
  if (!db || !currentMeetingId || closed || !Array.isArray(risks) || risks.length === 0) return;
  try {
    const insertMany = db.transaction((rows) => {
      for (const r of rows) {
        const text = sanitizeText(r.text, 1000);
        if (!text) continue;
        stmts.insertRisk.run(
          currentMeetingId,
          chunkId,
          text,
          sanitizeText(r.category, 20),
          sanitizeText(r.severity, 10)
        );
      }
    });
    insertMany(risks);
  } catch (err) {
    log('error', 'db', 'save_risks_failed', { count: risks.length, message: err.message });
  }
}

/**
 * Upsert a speaker profile. Topic is appended (deduped, capped) only for
 * medium/high significance chunks.
 */
function upsertSpeakerProfile(speaker, topic, significance) {
  if (!db || !currentMeetingId || closed) return;
  const cleanSpeaker = sanitizeText(speaker, 100);
  if (!cleanSpeaker) return;
  try {
    let topics = [];
    const existing = stmts.getSpeaker.get(currentMeetingId, cleanSpeaker);
    if (existing && existing.topics) {
      try { topics = JSON.parse(existing.topics); } catch (_) { topics = []; }
      if (!Array.isArray(topics)) topics = [];
    }
    const cleanTopic = sanitizeText(topic, 200);
    if (cleanTopic && (significance === 'medium' || significance === 'high') && !topics.includes(cleanTopic)) {
      topics.push(cleanTopic);
      if (topics.length > MAX_SPEAKER_TOPICS) topics = topics.slice(topics.length - MAX_SPEAKER_TOPICS);
    }
    stmts.upsertSpeaker.run(currentMeetingId, cleanSpeaker, JSON.stringify(topics));
  } catch (err) {
    log('error', 'db', 'upsert_speaker_failed', { message: err.message });
  }
}

/** Upsert glossary terms ({term: definition}). */
function upsertGlossary(terms) {
  if (!db || !currentMeetingId || closed || !terms || typeof terms !== 'object') return;
  const entries = Object.entries(terms);
  if (entries.length === 0) return;
  try {
    const upsertMany = db.transaction((rows) => {
      for (const [term, definition] of rows) {
        stmts.upsertGlossary.run(currentMeetingId, term, definition);
      }
    });
    upsertMany(entries);
  } catch (err) {
    log('error', 'db', 'upsert_glossary_failed', { count: entries.length, message: err.message });
  }
}

/** Increment the meeting's API-call usage counter. */
function incrementApiCalls(n) {
  if (!db || !currentMeetingId || closed || !Number.isFinite(n) || n <= 0) return;
  try {
    stmts.incrementApiCalls.run(n, currentMeetingId);
  } catch (err) {
    log('error', 'db', 'increment_api_calls_failed', { message: err.message });
  }
}

// --- Artifact writers ---------------------------------------------------------

function saveDecision(text, confidence = null, chunkId = null) {
  if (!db || !currentMeetingId || closed) return;
  const cleanText = sanitizeText(text, 1000);
  if (!cleanText) return;
  try {
    stmts.insertDecision.run(
      currentMeetingId,
      cleanText,
      typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : null,
      chunkId
    );
  } catch (err) {
    log('error', 'db', 'save_decision_failed', { message: err.message });
  }
}

function saveActionItem(text, assignee = null, deadline = null, chunkId = null) {
  if (!db || !currentMeetingId || closed) return;
  const cleanText = sanitizeText(text, 1000);
  if (!cleanText) return;
  try {
    stmts.insertActionItem.run(
      currentMeetingId,
      sanitizeText(assignee, 200) || 'Unassigned',
      cleanText,
      sanitizeText(deadline, 200),
      chunkId
    );
  } catch (err) {
    log('error', 'db', 'save_action_item_failed', { message: err.message });
  }
}

function saveTechnicalAnalysis(description) {
  if (!db || !currentMeetingId || closed) return;
  const cleanText = sanitizeText(description, 5000);
  if (!cleanText) return;
  try {
    stmts.insertAnalysis.run(currentMeetingId, cleanText);
  } catch (err) {
    log('error', 'db', 'save_analysis_failed', { message: err.message });
  }
}

function saveSuggestedReply(text) {
  if (!db || !currentMeetingId || closed) return;
  const cleanText = sanitizeText(text, 2000);
  if (!cleanText) return;
  try {
    stmts.insertReply.run(currentMeetingId, cleanText);
  } catch (err) {
    log('error', 'db', 'save_reply_failed', { message: err.message });
  }
}

// --- Aggregates (used for the deterministic fallback summary) -----------------

/**
 * Collect persisted artifacts for the current meeting. Returns empty shapes
 * on any failure — callers must be able to build a summary from nothing.
 */
function getMeetingAggregates() {
  const empty = { decisions: [], actionItems: [], risks: [], speakers: [], chunkCount: 0, topic: null };
  if (!db || !currentMeetingId || closed) return empty;
  try {
    const decisions = db.prepare(
      'SELECT description FROM decisions WHERE meeting_id = ? ORDER BY timestamp ASC'
    ).all(currentMeetingId).map((r) => r.description);
    const actionItems = db.prepare(
      'SELECT assignee, description, deadline FROM action_items WHERE meeting_id = ? ORDER BY timestamp ASC'
    ).all(currentMeetingId);
    const risks = db.prepare(
      'SELECT text, category, severity FROM risks WHERE meeting_id = ? ORDER BY created_at ASC'
    ).all(currentMeetingId);
    const speakers = db.prepare(
      'SELECT speaker, chunk_count, topics FROM speaker_profiles WHERE meeting_id = ? ORDER BY chunk_count DESC'
    ).all(currentMeetingId);
    const chunkRow = db.prepare('SELECT COUNT(*) AS c FROM chunks WHERE meeting_id = ?').get(currentMeetingId);
    const topicRow = db.prepare(
      'SELECT topic FROM chunks WHERE meeting_id = ? AND topic IS NOT NULL ORDER BY seq DESC LIMIT 1'
    ).get(currentMeetingId);
    return {
      decisions,
      actionItems,
      risks,
      speakers,
      chunkCount: chunkRow ? chunkRow.c : 0,
      topic: topicRow ? topicRow.topic : null,
    };
  } catch (err) {
    log('error', 'db', 'aggregates_failed', { message: err.message });
    return empty;
  }
}

// --- Lifecycle -----------------------------------------------------------------

/**
 * Final flush + meeting close. Idempotent.
 * @param {string} summary  executive (or fallback) summary text, '' if none
 * @param {'ended'|'aborted'|'exhausted'} [status='ended']
 * @param {'executive'|'fallback_template'} [kind='executive']
 */
async function endMeeting(summary, status = 'ended', kind = 'executive') {
  if (closed) return;
  closed = true;

  if (batchTimer) clearInterval(batchTimer);
  flushBatches();

  if (db && currentMeetingId) {
    try {
      const cleanSummary = sanitizeText(summary, 50000) || '';
      const txn = db.transaction(() => {
        stmts.endMeeting.run(cleanSummary || null, status, currentMeetingId);
        if (cleanSummary) {
          stmts.insertSummary.run(currentMeetingId, kind, cleanSummary);
        }
      });
      txn();
      log('info', 'db', 'meeting_ended', { meetingId: currentMeetingId, status, hasSummary: Boolean(cleanSummary) });
    } catch (err) {
      log('error', 'db', 'end_meeting_failed', { message: err.message });
    }
  }

  if (db) {
    try { db.close(); } catch (_) { /* best effort */ }
  }
}

// --- Diarization: speaker name persistence -----------------------------------

/** Persist a user-given display name for an STT label (cross-session). */
function saveSpeakerName(sttLabel, displayName) {
  if (!db) return;
  db.prepare(`
    INSERT INTO speaker_names (stt_label, display_name, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (stt_label) DO UPDATE SET display_name = excluded.display_name, updated_at = CURRENT_TIMESTAMP
  `).run(sttLabel, displayName);
}

/** Retrieve persisted display name for an STT label, or null. */
function getSpeakerName(sttLabel) {
  if (!db) return null;
  const row = db.prepare('SELECT display_name FROM speaker_names WHERE stt_label = ?').get(sttLabel);
  return row ? row.display_name : null;
}

/** Persist a MFCC embedding JSON array for cross-session voice matching. */
function saveSpeakerEmbedding(sttLabel, displayName, embeddingArray) {
  if (!db) return;
  try {
    db.prepare(
      'INSERT INTO speaker_embeddings (stt_label, display_name, embedding_json) VALUES (?, ?, ?)'
    ).run(sttLabel, displayName, JSON.stringify(embeddingArray));
  } catch (err) {
    log('warn', 'db', 'save_embedding_failed', { sttLabel, message: err.message });
  }
}

/** Load all stored MFCC embeddings for cross-session speaker matching. */
function getAllSpeakerEmbeddings() {
  if (!db) return [];
  try {
    return db.prepare('SELECT stt_label, display_name, embedding_json FROM speaker_embeddings').all();
  } catch (_) {
    return [];
  }
}

module.exports = {
  initDB,
  saveTranscript,
  saveChunk,
  saveRisks,
  upsertSpeakerProfile,
  upsertGlossary,
  incrementApiCalls,
  saveDecision,
  saveActionItem,
  saveTechnicalAnalysis,
  saveSuggestedReply,
  getMeetingAggregates,
  endMeeting,
  saveSpeakerName,
  getSpeakerName,
  saveSpeakerEmbedding,
  getAllSpeakerEmbeddings,
};
