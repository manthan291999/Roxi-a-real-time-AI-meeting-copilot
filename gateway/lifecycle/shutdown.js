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
 * @returns {(reason: string, status: 'ended'|'aborted'|'exhausted') => Promise<void>}
 */
function createShutdown({ session, providerCloser }) {
  let shuttingDown = false;

  return async function shutdown(reason, status) {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'sidecar', 'shutdown_started', { reason, status });

    let summary = '';
    try {
      summary = buildFallbackSummary(session.meetings.getAggregates());
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
    process.exit(status === 'ended' ? 0 : 1);
  };
}

module.exports = { createShutdown };
