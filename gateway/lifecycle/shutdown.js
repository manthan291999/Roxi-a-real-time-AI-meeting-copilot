/**
 * AI Meeting Interpreter — Shutdown Sequence
 *
 * Orchestrates teardown only: build the closing summary, announce it, flush and
 * close the database session, stop the STT provider, exit. Formatting lives in
 * summary-formatter.js and persistence in db/, both injected — this module
 * reaches into neither.
 */

'use strict';

const { buildFallbackSummary } = require('./summary-formatter.js');
const { emitMeetingSummary } = require('../infrastructure/stdout-protocol.js');
const { log } = require('../infrastructure/logger.js');

/**
 * Create the shutdown handler for a session.
 *
 * @param {Object} deps
 * @param {import('../db/index.js').MeetingSession} deps.session
 * @param {{close: () => Promise<void>}} deps.providerCloser  only close() is needed
 * @param {{flushAll: () => void}} [deps.transcriptFlusher]  only flushAll() is needed
 * @returns {(reason: string, status: 'ended'|'aborted'|'exhausted') => Promise<void>}
 */
function createShutdown({ session, providerCloser, transcriptFlusher }) {
  let shuttingDown = false;

  return async function shutdown(reason, status) {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'sidecar', 'shutdown_started', { reason, status });

    // First, before anything reads the session: the pipeline holds the utterance
    // currently being spoken, and nothing else will arrive to close it. Without
    // this the last thing said in every meeting is lost — and lost from the
    // aggregates the summary below is built from, too.
    try {
      if (transcriptFlusher) transcriptFlusher.flushAll();
    } catch (err) {
      log('error', 'sidecar', 'transcript_flush_failed', {
        message: (err.message || '').slice(0, 200),
      });
    }

    let summary = '';
    try {
      summary = buildFallbackSummary(session.artifacts.getAggregates());
      emitMeetingSummary(summary);
    } catch (err) {
      log('error', 'sidecar', 'summary_failed', { message: (err.message || '').slice(0, 200) });
    }

    try {
      session.close(summary, status, 'fallback_template');
    } catch (err) {
      log('error', 'sidecar', 'session_close_error', { message: (err.message || '').slice(0, 200) });
    }

    try {
      await providerCloser.close();
    } catch (_) {
      /* best-effort teardown */
    }

    log('info', 'sidecar', 'shutdown_complete', { reason });

    // process.stdout is asynchronous when it is a pipe — and it is, since the
    // Rust host holds the other end — so exiting immediately can truncate the
    // MeetingSummary line written above. The timer bounds the wait well inside
    // the 15s the host allows before force-killing.
    const code = status === 'ended' ? 0 : 1;
    if (process.stdout.writableLength > 0) {
      process.stdout.once('drain', () => process.exit(code));
      setTimeout(() => process.exit(code), 1000).unref();
    } else {
      process.exit(code);
    }
  };
}

module.exports = { createShutdown };
