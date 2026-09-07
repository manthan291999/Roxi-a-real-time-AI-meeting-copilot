/**
 * AI Meeting Interpreter — Transcript Repository
 *
 * The high-volume write path, and the only one that batches. Transcripts arrive
 * every few seconds for the length of a meeting, so they are flushed on a timer
 * inside a single transaction rather than one INSERT per turn.
 *
 * Never throws: a database failure must not kill the live audio pipeline.
 */

'use strict';

const { sanitizeText } = require('../infrastructure/validate.js');
const { log } = require('../infrastructure/logger.js');

const FLUSH_INTERVAL_MS = 5000;

class TranscriptRepository {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {number} meetingId
   * @param {{flushIntervalMs?: number}} [opts]
   */
  constructor(db, meetingId, { flushIntervalMs = FLUSH_INTERVAL_MS } = {}) {
    this.db = db;
    this.meetingId = meetingId;
    this.batch = [];
    this.closed = false;

    this.insert = db.prepare(
      'INSERT INTO transcripts (meeting_id, speaker, text) VALUES (?, ?, ?)'
    );
    this.insertMany = db.transaction((rows) => {
      for (const row of rows) this.insert.run(this.meetingId, row.speaker, row.text);
    });

    // unref so a pending timer never holds the process open at exit.
    this.timer = setInterval(() => this.flush(), flushIntervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  /** Queue a transcript line. Sanitized here, written on the next flush. */
  save(speaker, text) {
    if (this.closed) return;
    const cleanText = sanitizeText(text, 5000);
    if (!cleanText) return;
    this.batch.push({
      speaker: sanitizeText(speaker, 100) || 'Speaker',
      text: cleanText,
    });
  }

  /** Write everything queued. Safe to call at any time, including on shutdown. */
  flush() {
    if (this.batch.length === 0) return;
    const rows = this.batch;
    this.batch = [];
    try {
      this.insertMany(rows);
    } catch (err) {
      log('error', 'db', 'transcript_flush_failed', {
        count: rows.length,
        message: err.message,
      });
    }
  }

  /** Final flush and timer teardown. Idempotent. */
  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.flush();
  }
}

module.exports = { TranscriptRepository, FLUSH_INTERVAL_MS };
