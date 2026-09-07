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

async function main() {
  const cfg = config.load();
  logger.configure(cfg.logLevel);

  const check = config.validate(cfg);
  if (!check.ok) {
    protocol.emitError(`Missing required env vars: ${check.missing.join(', ')}`);
    process.exit(1);
  }

  const chain = buildChain(cfg.stt);
  if (chain.length === 0) {
    protocol.emitError('No STT providers configured');
    process.exit(1);
  }

  // --- Persistence ------------------------------------------------------------
  let session;
  try {
    session = startSession(cfg.dbPath, cfg.meeting.context);
  } catch (err) {
    protocol.emitError(`Database init failed: ${err.message}`);
    logger.log('error', 'sidecar', 'db_init_failed', {
      message: (err.message || '').slice(0, 300),
    });
    process.exit(1);
  }

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
  const commands = new CommandHandler({ meetings: session.meetings, diarization });
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
  manager.on('partial', (event) => pipeline.onPartial(event));
  manager.on('final', (event) => pipeline.onFinal(event));
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
  process.exit(1);
});
