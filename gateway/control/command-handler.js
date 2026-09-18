/**
 * AI Meeting Interpreter — Control Command Handler
 *
 * Handles CTL1 frames sent by the Rust host. Two kinds arrive:
 *
 *   persistChunk     the ChunkGraph finished analyzing a transcript chunk; the
 *                    chunk row is created and the reply path's artifacts stored.
 *   persistArtifacts the host's detached risk/analyst lane finished later; its
 *                    artifacts are attached to the chunk created above.
 *   renameSpeaker    the user renamed a speaker in the UI.
 *
 * Why persistence happens here rather than in Rust: the gateway is the sole
 * writer of meeting_history.db (Rust and the chatbot both read it, the latter
 * read-only, to avoid WAL write contention), and only this process knows the
 * current meeting id. Renames must also go through here because the diarization
 * layer holds in-session speaker state that a direct database write would not
 * invalidate.
 *
 * Every payload is re-validated: it crossed a process boundary before landing
 * in SQLite.
 */

'use strict';

const { validateArtifacts, validateChunkEnvelope } = require('../infrastructure/validate.js');
const { log } = require('../infrastructure/logger.js');

// How many chunkRef -> id pairs to retain. The detached lane resolves within
// seconds, so this is generously larger than any real in-flight window.
const MAX_TRACKED_CHUNKS = 200;

class CommandHandler {
  /**
   * @param {Object} deps
   * @param {Object} deps.artifacts    ArtifactRepository
   * @param {Object} deps.diarization  DiarizationLayer
   * @param {Object} deps.protocol     StdoutProtocol (optional)
   */
  constructor({ artifacts, diarization, protocol }) {
    this.artifacts = artifacts;
    this.diarization = diarization;
    this.protocol = protocol;
    this.chunkSeq = 0;
    // chunkRef -> chunk row id. The host's pipeline has two lanes, so a chunk's
    // artifacts arrive in two waves and the second must find the first's row.
    // Bounded: a meeting is finite, but the map is trimmed anyway so a very long
    // session cannot grow it without limit.
    this.chunkIds = new Map();
  }

  /** @param {{command: string} & Object} message */
  handle(message) {
    if (!message || typeof message.command !== 'string') {
      log('warn', 'control', 'malformed_command', {});
      return;
    }

    switch (message.command) {
      case 'persistChunk':
        this.persistChunk(message);
        break;
      case 'persistArtifacts':
        this.persistArtifacts(message);
        break;
      case 'renameSpeaker':
        this.renameSpeaker(message);
        break;
      default:
        log('warn', 'control', 'unknown_command', { command: message.command });
    }
  }

  /**
   * Persist an analyzed chunk plus everything derived from it. Artifacts are
   * written in the same transaction as the chunk so they cannot be orphaned.
   */
  persistChunk(message) {
    const chunk = validateChunkEnvelope(message.chunk);
    if (!chunk.ok) {
      log('warn', 'control', 'invalid_chunk_envelope', { reason: chunk.reason });
      return;
    }

    const artifacts = validateArtifacts(message.artifacts);
    const seq = this.chunkSeq++;

    const chunkId = this.artifacts.saveAnalyzedChunk(
      {
        seq,
        speaker: chunk.speaker,
        text: chunk.text,
        significance: chunk.significance,
        topic: chunk.topic,
      },
      artifacts
    );

    if (chunkId === null) return;

    if (message.chunkRef) this.rememberChunk(message.chunkRef, chunkId);

    // Secondary artifacts, each independent of the chunk row.
    if (message.technicalAnalysis) {
      this.artifacts.saveTechnicalAnalysis(message.technicalAnalysis);
    }
    if (message.suggestedReply) {
      this.artifacts.saveSuggestedReply(message.suggestedReply);
    }
    if (message.glossary) {
      this.artifacts.upsertGlossary(message.glossary);
    }
    this.artifacts.upsertSpeakerProfile(chunk.speaker, chunk.topic, chunk.significance);

    if (this.protocol && this.protocol.emitChunkPersisted) {
      this.protocol.emitChunkPersisted(chunkId);
    }

    log('info', 'control', 'chunk_persisted', {
      seq,
      chunkId,
      decisions: artifacts.decisions.length,
      actionItems: artifacts.actionItems.length,
      risks: artifacts.risks.length,
    });
  }

  /**
   * Second wave: artifacts from the host's detached lane, attached to the chunk
   * its first wave created.
   */
  persistArtifacts(message) {
    const chunkId = this.chunkIds.get(message.chunkRef);
    if (!chunkId) {
      // The chunk row was never created (its first wave failed validation, or
      // the reference is stale). Dropping is correct: an artifact with no chunk
      // has no meeting position to be read back at.
      log('warn', 'control', 'artifacts_without_chunk', { chunkRef: message.chunkRef });
      return;
    }

    const artifacts = validateArtifacts(message.artifacts);
    this.artifacts.saveArtifacts(chunkId, artifacts);

    log('info', 'control', 'artifacts_persisted', {
      chunkRef: message.chunkRef,
      decisions: artifacts.decisions.length,
      actionItems: artifacts.actionItems.length,
      risks: artifacts.risks.length,
    });
  }

  rememberChunk(chunkRef, chunkId) {
    this.chunkIds.set(chunkRef, chunkId);
    if (this.chunkIds.size > MAX_TRACKED_CHUNKS) {
      // Oldest first (Map preserves insertion order). The detached lane lands
      // within seconds, so anything this old will never be referenced again.
      this.chunkIds.delete(this.chunkIds.keys().next().value);
    }
  }

  renameSpeaker(message) {
    const applied = this.diarization.rename(message.sttLabel, message.displayName);
    if (!applied) {
      log('warn', 'control', 'rename_rejected', { sttLabel: message.sttLabel });
    }
  }
}

module.exports = { CommandHandler };
