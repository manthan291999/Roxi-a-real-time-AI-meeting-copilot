/**
 * AI Meeting Interpreter — Meeting Repository
 *
 * Meeting lifecycle plus the per-chunk artifacts produced by the Rust
 * ChunkGraph and delivered back over the control channel. Everything here is
 * written immediately rather than batched: these arrive at most once per
 * analyzed chunk, and writing them eagerly means a crash loses at most the
 * in-flight chunk.
 *
 * Never throws — a database failure must not kill the live pipeline.
 */

'use strict';

const { sanitizeText } = require('../infrastructure/validate.js');
const { log } = require('../infrastructure/logger.js');
const { ProjectRepository, formatDisplayId } = require('./project-repository.js');

const MAX_SPEAKER_TOPICS = 10;

class MeetingRepository {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {number} meetingId
   */
  constructor(db, meetingId, project = null, displayId = null) {
    this.db = db;
    this.meetingId = meetingId;
    /** @type {{projectId: number, code: string, name: string}|null} */
    this.project = project;
    /** `ROXI-007` — the identity the UI shows and people say out loud. */
    this.displayId = displayId;
    this.closed = false;
    this.stmts = {
      insertChunk: db.prepare(
        'INSERT INTO chunks (meeting_id, seq, speaker, text, significance, topic) VALUES (?, ?, ?, ?, ?, ?)'
      ),
      insertRisk: db.prepare(
        'INSERT INTO risks (meeting_id, chunk_id, text, category, severity) VALUES (?, ?, ?, ?, ?)'
      ),
      insertDecision: db.prepare(
        'INSERT INTO decisions (meeting_id, description, confidence, chunk_id) VALUES (?, ?, ?, ?)'
      ),
      insertActionItem: db.prepare(
        'INSERT INTO action_items (meeting_id, assignee, description, deadline, chunk_id) VALUES (?, ?, ?, ?, ?)'
      ),
      insertAnalysis: db.prepare(
        'INSERT INTO technical_analyses (meeting_id, description) VALUES (?, ?)'
      ),
      insertReply: db.prepare('INSERT INTO suggested_replies (meeting_id, text) VALUES (?, ?)'),
      insertSummary: db.prepare('INSERT INTO summaries (meeting_id, kind, text) VALUES (?, ?, ?)'),
      upsertSpeaker: db.prepare(`
        INSERT INTO speaker_profiles (meeting_id, speaker, chunk_count, topics, last_seen)
        VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (meeting_id, speaker) DO UPDATE SET
          chunk_count = chunk_count + 1,
          topics = excluded.topics,
          last_seen = CURRENT_TIMESTAMP
      `),
      getSpeaker: db.prepare(
        'SELECT topics FROM speaker_profiles WHERE meeting_id = ? AND speaker = ?'
      ),
      upsertGlossary: db.prepare(`
        INSERT INTO glossary_terms (meeting_id, term, definition)
        VALUES (?, ?, ?)
        ON CONFLICT (meeting_id, term) DO UPDATE SET definition = excluded.definition
      `),
      endMeeting: db.prepare(
        'UPDATE meetings SET summary = ?, end_time = CURRENT_TIMESTAMP, status = ? WHERE id = ?'
      ),
    };
  }

  /**
   * Create the meeting row. Static because it produces the id every other
   * repository is scoped to.
   *
   * The project, its sequence number and the display id are assigned in ONE
   * transaction with the insert: `project_seq` is `MAX + 1`, so computing it
   * outside the transaction lets two concurrent captures allocate the same
   * number and produce two `ROXI-008`s.
   *
   * @param {import('better-sqlite3').Database} db
   * @param {string} [meetingContext] user-supplied briefing
   * @param {{id?: number|null}} [projectSelection] from the Rust host's argv
   * @param {string} [meetingRole]
   * @param {string} [meetingName] user-chosen title, collected at capture start
   * @returns {MeetingRepository}
   */
  static start(db, meetingContext = '', projectSelection = {}, meetingRole = null, meetingName = null) {
    const context = sanitizeText(meetingContext, 2000);
    const role = sanitizeText(meetingRole, 100);
    const name = sanitizeText(meetingName, 200);
    const projects = new ProjectRepository(db);
    const project = projects.resolve(projectSelection);

    const insert = db.transaction(() => {
      if (!project) {
        // Neither the selected project nor `Unsorted` exists — a broken or
        // un-migrated schema. Insert unscoped rather than fail the meeting:
        // the user is about to be in a meeting, and taxonomy is never worth
        // blocking capture on.
        const info = db
          .prepare('INSERT INTO meetings (context, role, name) VALUES (?, ?, ?)')
          .run(context || null, role || null, name || null);
        return { meetingId: info.lastInsertRowid, displayId: null };
      }

      const seq = projects.nextSeq(project.projectId);
      const displayId = formatDisplayId(project.code, seq);
      const info = db
        .prepare(
          'INSERT INTO meetings (context, project_id, project_seq, display_id, role, name) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(context || null, project.projectId, seq, displayId, role || null, name || null);
      return { meetingId: info.lastInsertRowid, displayId };
    });

    const { meetingId, displayId } = insert();
    log('info', 'db', 'meeting_started', {
      meetingId,
      displayId,
      projectId: project ? project.projectId : null,
    });

    return new MeetingRepository(db, meetingId, project, displayId);
  }

  // --- Per-chunk artifacts ----------------------------------------------------

  /**
   * Persist an analyzed chunk and everything derived from it, in one
   * transaction — the artifacts reference the chunk's row id, so a partial
   * write would orphan them.
   *
   * @param {{seq: number, speaker: string, text: string, significance: ?string, topic: ?string}} chunk
   * @param {{decisions: Array, actionItems: Array, risks: Array}} artifacts
   * @returns {number|null} the chunk row id, or null on failure
   */
  saveAnalyzedChunk(chunk, artifacts = { decisions: [], actionItems: [], risks: [] }) {
    if (this.closed) return null;
    const cleanText = sanitizeText(chunk.text, 10000);
    if (!cleanText) return null;

    try {
      const write = this.db.transaction(() => {
        const info = this.stmts.insertChunk.run(
          this.meetingId,
          chunk.seq,
          sanitizeText(chunk.speaker, 100) || 'Speaker',
          cleanText,
          sanitizeText(chunk.significance, 20),
          sanitizeText(chunk.topic, 200)
        );
        const chunkId = info.lastInsertRowid;

        for (const d of artifacts.decisions || []) {
          this.stmts.insertDecision.run(this.meetingId, d.text, d.confidence, chunkId);
        }
        for (const a of artifacts.actionItems || []) {
          this.stmts.insertActionItem.run(
            this.meetingId,
            a.assignee || 'Unassigned',
            a.text,
            a.deadline,
            chunkId
          );
        }
        for (const r of artifacts.risks || []) {
          this.stmts.insertRisk.run(this.meetingId, chunkId, r.text, r.category, r.severity);
        }
        return chunkId;
      });

      return write();
    } catch (err) {
      log('error', 'db', 'save_analyzed_chunk_failed', { seq: chunk.seq, message: err.message });
      return null;
    }
  }

  /**
   * Attach artifacts to an existing chunk. Used for the host's detached
   * risk/analyst lane, which finishes after the chunk row was created.
   */
  saveArtifacts(chunkId, artifacts) {
    if (this.closed || !chunkId) return;
    const { decisions = [], actionItems = [], risks = [] } = artifacts || {};
    if (decisions.length === 0 && actionItems.length === 0 && risks.length === 0) return;

    try {
      const write = this.db.transaction(() => {
        for (const d of decisions) {
          this.stmts.insertDecision.run(this.meetingId, d.text, d.confidence, chunkId);
        }
        for (const a of actionItems) {
          this.stmts.insertActionItem.run(
            this.meetingId,
            a.assignee || 'Unassigned',
            a.text,
            a.deadline,
            chunkId
          );
        }
        for (const r of risks) {
          this.stmts.insertRisk.run(this.meetingId, chunkId, r.text, r.category, r.severity);
        }
      });
      write();
    } catch (err) {
      log('error', 'db', 'save_artifacts_failed', { chunkId, message: err.message });
    }
  }

  saveTechnicalAnalysis(description) {
    if (this.closed) return;
    const clean = sanitizeText(description, 5000);
    if (!clean) return;
    try {
      this.stmts.insertAnalysis.run(this.meetingId, clean);
    } catch (err) {
      log('error', 'db', 'save_analysis_failed', { message: err.message });
    }
  }

  saveSuggestedReply(text) {
    if (this.closed) return;
    const clean = sanitizeText(text, 2000);
    if (!clean) return;
    try {
      this.stmts.insertReply.run(this.meetingId, clean);
    } catch (err) {
      log('error', 'db', 'save_reply_failed', { message: err.message });
    }
  }

  /**
   * Upsert a speaker profile. The topic is appended (deduped, capped) only for
   * medium/high significance chunks.
   */
  upsertSpeakerProfile(speaker, topic, significance) {
    if (this.closed) return;
    const cleanSpeaker = sanitizeText(speaker, 100);
    if (!cleanSpeaker) return;
    try {
      let topics = [];
      const existing = this.stmts.getSpeaker.get(this.meetingId, cleanSpeaker);
      if (existing && existing.topics) {
        try {
          topics = JSON.parse(existing.topics);
        } catch (_) {
          topics = [];
        }
        if (!Array.isArray(topics)) topics = [];
      }
      const cleanTopic = sanitizeText(topic, 200);
      if (
        cleanTopic &&
        (significance === 'medium' || significance === 'high') &&
        !topics.includes(cleanTopic)
      ) {
        topics.push(cleanTopic);
        if (topics.length > MAX_SPEAKER_TOPICS) {
          topics = topics.slice(topics.length - MAX_SPEAKER_TOPICS);
        }
      }
      this.stmts.upsertSpeaker.run(this.meetingId, cleanSpeaker, JSON.stringify(topics));
    } catch (err) {
      log('error', 'db', 'upsert_speaker_failed', { message: err.message });
    }
  }

  /** Upsert glossary terms ({term: definition}). */
  upsertGlossary(terms) {
    if (this.closed || !terms || typeof terms !== 'object') return;
    const entries = Object.entries(terms);
    if (entries.length === 0) return;
    try {
      const upsertMany = this.db.transaction((rows) => {
        for (const [term, definition] of rows) {
          const cleanTerm = sanitizeText(term, 100);
          const cleanDef = sanitizeText(definition, 500);
          if (cleanTerm && cleanDef) {
            this.stmts.upsertGlossary.run(this.meetingId, cleanTerm, cleanDef);
          }
        }
      });
      upsertMany(entries);
    } catch (err) {
      log('error', 'db', 'upsert_glossary_failed', { count: entries.length, message: err.message });
    }
  }

  // --- Aggregates ---------------------------------------------------------------

  /**
   * Collect persisted artifacts for this meeting. Returns empty shapes on any
   * failure — callers must be able to build a summary from nothing.
   */
  getAggregates() {
    const empty = {
      decisions: [],
      actionItems: [],
      risks: [],
      speakers: [],
      chunkCount: 0,
      topic: null,
    };
    try {
      const decisions = this.db
        .prepare('SELECT description FROM decisions WHERE meeting_id = ? ORDER BY timestamp ASC')
        .all(this.meetingId)
        .map((r) => r.description);
      const actionItems = this.db
        .prepare(
          'SELECT assignee, description, deadline FROM action_items WHERE meeting_id = ? ORDER BY timestamp ASC'
        )
        .all(this.meetingId);
      const risks = this.db
        .prepare(
          'SELECT text, category, severity FROM risks WHERE meeting_id = ? ORDER BY created_at ASC'
        )
        .all(this.meetingId);
      const speakers = this.db
        .prepare(
          'SELECT speaker, chunk_count, topics FROM speaker_profiles WHERE meeting_id = ? ORDER BY chunk_count DESC'
        )
        .all(this.meetingId);
      const chunkRow = this.db
        .prepare('SELECT COUNT(*) AS c FROM chunks WHERE meeting_id = ?')
        .get(this.meetingId);
      const topicRow = this.db
        .prepare(
          'SELECT topic FROM chunks WHERE meeting_id = ? AND topic IS NOT NULL ORDER BY seq DESC LIMIT 1'
        )
        .get(this.meetingId);

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

  // --- Lifecycle ----------------------------------------------------------------

  /**
   * Close the meeting row. Idempotent.
   *
   * @param {string} summary
   * @param {'ended'|'aborted'|'exhausted'} [status='ended']
   * @param {string} [kind='executive']
   */
  end(summary, status = 'ended', kind = 'executive') {
    if (this.closed) return;
    this.closed = true;
    try {
      const cleanSummary = sanitizeText(summary, 50000) || '';
      const txn = this.db.transaction(() => {
        this.stmts.endMeeting.run(cleanSummary || null, status, this.meetingId);
        if (cleanSummary) {
          this.stmts.insertSummary.run(this.meetingId, kind, cleanSummary);
        }
      });
      txn();
      log('info', 'db', 'meeting_ended', {
        meetingId: this.meetingId,
        status,
        hasSummary: Boolean(cleanSummary),
      });
    } catch (err) {
      log('error', 'db', 'end_meeting_failed', { message: err.message });
    }
  }
}

module.exports = { MeetingRepository, MAX_SPEAKER_TOPICS };
