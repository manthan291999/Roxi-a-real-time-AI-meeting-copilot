/**
 * AI Meeting Interpreter — Meeting Repository
 *
 * The meeting row's lifecycle only: create it, close it. The per-chunk
 * artifacts produced by the Rust ChunkGraph (chunks/decisions/action items/
 * risks/analyses/replies/speaker profiles/glossary) live in
 * ArtifactRepository (artifact-repository.js) — both stay scoped to one
 * meetingId; this file used to own both and was the gateway's SRP hotspot.
 *
 * Never throws — a database failure must not kill the live pipeline.
 */

'use strict';

const { sanitizeText } = require('../infrastructure/validate.js');
const { log } = require('../infrastructure/logger.js');
const { ProjectRepository, formatDisplayId } = require('./project-repository.js');

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
      insertSummary: db.prepare('INSERT INTO summaries (meeting_id, kind, text) VALUES (?, ?, ?)'),
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
   * @param {string|null} [accountId] the signed-in account that owns this
   *   meeting; null in local-only mode, where every meeting is visible
   * @returns {MeetingRepository}
   */
  static start(db, meetingContext = '', projectSelection = {}, meetingRole = null, meetingName = null, accountId = null) {
    const context = sanitizeText(meetingContext, 2000);
    const role = sanitizeText(meetingRole, 100);
    const name = sanitizeText(meetingName, 200);
    const owner = sanitizeText(accountId, 100) || null;
    const projects = new ProjectRepository(db);
    const project = projects.resolve(projectSelection);

    const insert = db.transaction(() => {
      if (!project) {
        // Neither the selected project nor `Unsorted` exists — a broken or
        // un-migrated schema. Insert unscoped rather than fail the meeting:
        // the user is about to be in a meeting, and taxonomy is never worth
        // blocking capture on.
        const info = db
          .prepare('INSERT INTO meetings (context, role, name, account_id) VALUES (?, ?, ?, ?)')
          .run(context || null, role || null, name || null, owner);
        return { meetingId: info.lastInsertRowid, displayId: null };
      }

      const seq = projects.nextSeq(project.projectId);
      const displayId = formatDisplayId(project.code, seq);
      const info = db
        .prepare(
          'INSERT INTO meetings (context, project_id, project_seq, display_id, role, name, account_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(context || null, project.projectId, seq, displayId, role || null, name || null, owner);
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

module.exports = { MeetingRepository };
