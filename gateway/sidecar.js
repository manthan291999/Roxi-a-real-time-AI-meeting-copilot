/**
 * AI Meeting Interpreter — Gateway Sidecar (composition root)
 *
 * Spawned by the Rust host. Reads framed audio and control commands from stdin,
 * streams audio to an STT provider, and writes transcript events to stdout.
 *
 * This file only wires collaborators together. Configuration lives in config/,
 * the wire format in infrastructure/stdout-protocol.js, persistence in db/, and
 * per-turn logic in the pipeline module below.
 */

'use strict';

const config = require('./config/index.js');
const logger = require('./infrastructure/logger.js');
const protocol = require('./infrastructure/stdout-protocol.js');
const mfcc = require('./infrastructure/mfcc.js');
const { startSession } = require('./db/index.js');
const { buildChain } = require('./stt/provider-registry.js');
const { ProviderManager } = require('./stt/provider-manager.js');
const { DiarizationLayer } = require('./stt/diarization-layer.js');
const { TranscriptSanitizer } = require('./stt/transcript-sanitizer.js');
const { PcmDeframer } = require('./audio/pcm-deframer.js');
const { CommandHandler } = require('./control/command-handler.js');
const { TranscriptPipeline } = require('./stt/transcript-pipeline.js');
const { createShutdown } = require('./lifecycle/shutdown.js');

/**
 * Exit only once stdout has actually flushed. stdout is a pipe here — the
 * Rust host holds the other end — so calling process.exit() right after a
 * synchronous protocol.emitError() write can truncate that very line before
 * the host ever reads it: exactly how "both STT keys missing/invalid" used
 * to fail silently — the UI would go live and just never transcribe, with
 * no capture_error shown, because the error line never made it out before
 * the pipe tore down. Same guard lifecycle/shutdown.js already uses for the
 * same reason, applied here to every early-exit path in this file.
 */
function exitAfterDrain(code) {
  if (process.stdout.writableLength > 0) {
    process.stdout.once('drain', () => process.exit(code));
    setTimeout(() => process.exit(code), 1000).unref();
  } else {
    process.exit(code);
  }
}

async function main() {
  const cfg = config.load();
  logger.configure(cfg.logLevel);

  const check = config.validate(cfg);
  if (!check.ok) {
    protocol.emitError(`Missing required env vars: ${check.missing.join(', ')}`);
    exitAfterDrain(1);
    return;
  }

  const chain = buildChain(cfg.stt);
  if (chain.length === 0) {
    protocol.emitError('No STT providers configured');
    exitAfterDrain(1);
    return;
  }

  // --- Persistence ------------------------------------------------------------
  let session;
  try {
    session = startSession(cfg.dbPath, cfg.meeting.context, { id: cfg.meeting.projectId }, cfg.meeting.role);
  } catch (err) {
    protocol.emitError(`Database init failed: ${err.message}`);
    logger.log('error', 'sidecar', 'db_init_failed', {
      message: (err.message || '').slice(0, 300),
    });
    exitAfterDrain(1);
    return;
  }

  // Announced before any transcript can arrive, so the host has the meeting id
  // for the first chunk's usage rows.
  protocol.emitMeetingStarted(
    session.meetingId,
    session.displayId,
    session.project ? session.project.projectId : null
  );

  // --- Collaborators ----------------------------------------------------------
  // Each receives only what it needs: the diarization layer gets the 4-method
  // speaker repository, not the whole session; the shutdown handler gets an
  // object with close(), not the provider manager.
  const diarization = new DiarizationLayer(session.speakers, mfcc);
  const manager = new ProviderManager(chain);
  const pipeline = new TranscriptPipeline({
    diarization,
    sanitizer: new TranscriptSanitizer(),
    transcripts: session.transcripts,
    protocol,
  });
  const commands = new CommandHandler({ meetings: session.meetings, diarization, protocol });
  const deframer = new PcmDeframer(
    {
      // Audio fans out to both STT and diarization; the latter buffers it for
      // attribution once the turn finalizes.
      sendAudio(payload) {
        manager.sendAudio(payload);
        diarization.pushAudio(payload);
      },
    },
    commands
  );
  const shutdown = createShutdown({ session, providerCloser: manager });

  // --- Event wiring -----------------------------------------------------------
  manager.on('status', ({ provider, state }) => {
    protocol.emitProviderStatus(provider, state);
    logger.log('info', 'sidecar', 'provider_status', { provider, state });
  });
  // The pipeline can throw synchronously (e.g. a corrupt stored speaker
  // embedding reaching diarization, or a DB write failure) — unguarded, that
  // exception propagates back through the provider's own event emission and
  // crashes the whole sidecar process. After that, stdout never emits another
  // line, which reads to the UI as "the live transcript just stopped." Contain
  // failures per-turn instead so one bad turn doesn't end the session.
  manager.on('partial', (event) => {
    try {
      pipeline.onPartial(event);
    } catch (err) {
      logger.log('error', 'sidecar', 'pipeline_partial_failed', {
        message: (err.message || '').slice(0, 300),
      });
    }
  });
  manager.on('final', (event) => {
    try {
      pipeline.onFinal(event);
    } catch (err) {
      logger.log('error', 'sidecar', 'pipeline_final_failed', {
        message: (err.message || '').slice(0, 300),
      });
    }
  });
  manager.on('speakerRevision', ({ revision }) => protocol.emitSpeakerRevision(revision));
  manager.on('providerError', ({ provider, message }) => {
    logger.log('warn', 'sidecar', 'stt_provider_error', {
      provider,
      message: (message || '').slice(0, 200),
    });
  });
  manager.on('error', ({ message }) => {
    protocol.emitError(message);
    logger.log('error', 'sidecar', 'stt_error', { message: (message || '').slice(0, 200) });
  });
  manager.on('exhausted', () => shutdown('stt_exhausted', 'exhausted'));

  // --- Process lifecycle -------------------------------------------------------
  process.stdin.resume();
  process.stdin.on('data', (data) => deframer.append(data));
  process.stdin.on('end', () => shutdown('stdin_end', 'ended'));
  process.on('SIGTERM', () => shutdown('sigterm', 'ended'));
  process.on('SIGINT', () => shutdown('sigint', 'ended'));

  await manager.start();
}

main().catch((err) => {
  protocol.emitError(`Sidecar failed to start: ${err.message}`);
  logger.log('error', 'sidecar', 'startup_failed', {
    message: (err.message || '').slice(0, 300),
  });
  exitAfterDrain(1);
});
