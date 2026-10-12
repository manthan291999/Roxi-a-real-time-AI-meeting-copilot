/**
 * AI Meeting Interpreter — Persistence Composition Root
 *
 * Opens the database and hands back the three narrow repositories the rest of
 * the gateway consumes. Nothing here is module-level state: callers hold the
 * session and inject the pieces each collaborator needs, which is what lets the
 * repositories be tested against ':memory:' and lets a single process open more
 * than one meeting.
 *
 * Ownership note: the gateway is the sole writer of meeting_history.db. The
 * Rust host reads it (adapters/sqlite.rs) and the chatbot reads it read-only,
 * both to avoid WAL write contention. Artifacts produced by the Rust agent
 * pipeline are therefore sent back over the control channel and written here,
 * rather than written directly by Rust.
 */

'use strict';

const { open } = require('./connection.js');
const { MeetingRepository } = require('./meeting-repository.js');
const { ArtifactRepository } = require('./artifact-repository.js');
const { TranscriptRepository } = require('./transcript-repository.js');
const { SpeakerRepository } = require('./speaker-repository.js');

/**
 * One open database plus the repositories scoped to one meeting.
 */
class MeetingSession {
  constructor(db, meetings, artifacts, transcripts, speakers) {
    this.db = db;
    this.meetings = meetings;
    this.artifacts = artifacts;
    this.transcripts = transcripts;
    this.speakers = speakers;
    this.closed = false;
  }

  get meetingId() {
    return this.meetings.meetingId;
  }

  /** `ROXI-007`, or null on an unscoped meeting. */
  get displayId() {
    return this.meetings.displayId;
  }

  /** The resolved project, or null on an unscoped meeting. */
  get project() {
    return this.meetings.project;
  }

  /**
   * Flush pending writes, close the meeting row, and release the file.
   * Idempotent.
   *
   * Ordering matters: transcripts flush *before* the meeting is marked ended,
   * so the last few seconds of speech are not lost. (The previous singleton set
   * its `closed` flag before flushing, which made the final flush a no-op and
   * silently dropped up to one flush interval of transcript on every meeting.)
   */
  close(summary, status = 'ended', kind = 'executive') {
    if (this.closed) return;
    this.closed = true;

    this.transcripts.close();
    this.artifacts.close();
    this.meetings.end(summary, status, kind);

    try {
      this.db.close();
    } catch (_) {
      /* best effort */
    }
  }
}

/**
 * Open the database and start a meeting.
 *
 * @param {string} dbPath          from config; ':memory:' in tests
 * @param {string} [meetingContext] user-supplied briefing
 * @param {{id?: number|null}} [projectSelection] resolved by the Rust host
 * @param {string} [meetingRole]
 * @param {string} [meetingName] user-chosen title, collected at capture start
 * @returns {MeetingSession}
 * @throws if the database cannot be opened or migrated
 */
function startSession(dbPath, meetingContext = '', projectSelection = {}, meetingRole = null, meetingName = null, accountId = null) {
  const { db } = open(dbPath);
  const meetings = MeetingRepository.start(db, meetingContext, projectSelection, meetingRole, meetingName, accountId);
  return new MeetingSession(
    db,
    meetings,
    new ArtifactRepository(db, meetings.meetingId),
    new TranscriptRepository(db, meetings.meetingId),
    new SpeakerRepository(db)
  );
}

module.exports = { startSession, MeetingSession };
