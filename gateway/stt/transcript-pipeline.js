/**
 * AI Meeting Interpreter — Per-turn Transcript Pipeline
 *
 * The business logic that runs on every STT event: validate → sanitize →
 * resolve speaker → emit → attribute audio → persist. This used to live inline
 * in the composition root, which mixed wiring with behaviour and made it
 * untestable without spawning the process.
 *
 * Collaborators are injected, so a test can drive this with fakes and assert on
 * what was emitted and stored.
 */

'use strict';

const { validateTranscriptEvent } = require('../infrastructure/validate.js');
const { log } = require('../infrastructure/logger.js');

class TranscriptPipeline {
  /**
   * @param {Object} deps
   * @param {Object} deps.diarization  resolveLabel / attributeTurn
   * @param {Object} deps.sanitizer    sanitize(text, confidence)
   * @param {Object} deps.transcripts  save(speaker, text)
   * @param {Object} deps.protocol     emitPartial / emitFinal
   */
  constructor({ diarization, sanitizer, transcripts, protocol }) {
    this.diarization = diarization;
    this.sanitizer = sanitizer;
    this.transcripts = transcripts;
    this.protocol = protocol;
  }

  onPartial({ text, speaker: sttLabel }) {
    const displayName = this.diarization.resolveLabel(sttLabel);
    this.protocol.emitPartial(text, displayName, sttLabel);
  }

  onFinal(event) {
    const validated = validateTranscriptEvent(event);
    if (!validated.ok) {
      log('warn', 'sidecar', 'invalid_transcript_event', { reason: validated.reason });
      this.retirePartial(event && event.speaker);
      return;
    }

    const { text, speaker: sttLabel, confidence } = validated;

    const sanitized = this.sanitizer.sanitize(text, confidence);
    if (!sanitized.ok) {
      log('info', 'sidecar', 'chunk_dropped_sanitizer', { reason: sanitized.reason, text });
      // The turn is discarded, but the audio it buffered still belongs to this
      // speaker — attribute it so the voice embedding stays accurate.
      this.diarization.attributeTurn(sttLabel);
      this.retirePartial(sttLabel);
      return;
    }

    const displayName = this.diarization.resolveLabel(sttLabel);
    this.protocol.emitFinal(
      sanitized.text,
      displayName,
      sttLabel,
      event.start,
      event.end,
      event.turnOrder
    );

    this.diarization.attributeTurn(sttLabel);
    this.transcripts.save(displayName, sanitized.text);
  }

  /**
   * Withdraw the partial a turn had already put on screen, for the two paths
   * that end a turn without emitting a final.
   *
   * The UI clears a partial when the matching final arrives. Returning early
   * from onFinal without saying anything left the turn's last words frozen in
   * the live pane, and a stuck partial there also suppressed every later one —
   * the "live transcript sometimes doesn't show" symptom. An empty-text Partial
   * is the withdrawal signal; it needs no new message type, and a consumer that
   * ignores it is no worse off than before.
   */
  retirePartial(sttLabel) {
    if (!sttLabel) return;
    this.protocol.emitPartial('', this.diarization.resolveLabel(sttLabel), sttLabel);
  }
}

module.exports = { TranscriptPipeline };
