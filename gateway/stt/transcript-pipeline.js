/**
 * AI Meeting Interpreter — Per-turn Transcript Pipeline
 *
 * The business logic that runs on every STT event: validate → sanitize →
 * resolve speaker → accumulate → emit → attribute audio → persist. This used to
 * live inline in the composition root, which mixed wiring with behaviour and
 * made it untestable without spawning the process.
 *
 * Collaborators are injected, so a test can drive this with fakes and assert on
 * what was emitted and stored.
 *
 * ## Why finals are buffered rather than emitted directly
 *
 * A provider's "turn" is its own unit, not ours. Universal-3.5-Pro ends a turn
 * on punctuation, so a single spoken sentence can arrive as six finals —
 * "Hey there." / "How are" / "you?" — and each one used to become its own
 * transcript row, its own UI line, and its own ChunkGraph run on the premium
 * model. One meeting produced 511 of them.
 *
 * So an utterance is assembled here instead: fragments accumulate per speaker
 * and are promoted to a real Final only once that speaker has actually stopped
 * (UTTERANCE_GAP_MS), been interrupted by someone else, or the session ended.
 * The pipeline is then independent of how finely the provider chops turns,
 * rather than at its mercy.
 *
 * Nothing is discarded by this — the accumulated text is emitted in full. It is
 * the replacement for an older `MIN_WORDS = 2` floor in the sanitizer, which
 * suppressed the symptom by deleting short speech outright.
 */

'use strict';

const { validateTranscriptEvent } = require('../infrastructure/validate.js');
const { log } = require('../infrastructure/logger.js');

/**
 * Silence that closes an utterance, in ms.
 *
 * The fragments this joins arrive far faster than the provider's own
 * end-of-turn silence, so this sits above the gap between them and below the
 * pause that separates two genuine utterances. Too low and one sentence still
 * splits; too high and a speaker's line lags visibly behind the room. The live
 * pane is not waiting on this — it shows the text as it accumulates — so this
 * only governs when a line is committed.
 */
const UTTERANCE_GAP_MS = 900;

class TranscriptPipeline {
  /**
   * @param {Object} deps
   * @param {Object} deps.diarization  resolveLabel / attributeTurn
   * @param {Object} deps.sanitizer    sanitize(text, confidence)
   * @param {Object} deps.transcripts  save(speaker, text)
   * @param {Object} deps.protocol     emitPartial / emitFinal
   * @param {number} [deps.utteranceGapMs]  override the gap; tests use a short one
   */
  constructor({ diarization, sanitizer, transcripts, protocol, utteranceGapMs = UTTERANCE_GAP_MS }) {
    this.diarization = diarization;
    this.sanitizer = sanitizer;
    this.transcripts = transcripts;
    this.protocol = protocol;
    this.utteranceGapMs = utteranceGapMs;

    /**
     * In-flight utterances, keyed by STT label rather than display name: a
     * rename mid-session changes the display name and would otherwise orphan
     * the buffer. Two people talking over each other keep separate entries, so
     * their words never interleave into one line.
     *
     * @type {Map<string, {parts: string[], start: any, end: any, turnOrder: any, timer: any}>}
     */
    this.buffers = new Map();
  }

  onPartial({ text, speaker: sttLabel }) {
    const displayName = this.diarization.resolveLabel(sttLabel);
    // Prepend whatever this speaker has already said in this utterance, so the
    // pane shows the sentence growing word by word instead of repainting from
    // empty every time the provider closes one of its short turns.
    this.protocol.emitPartial(this.withBuffered(sttLabel, text), displayName, sttLabel);
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

    // Someone else finishing a fragment means this speaker has stopped: close
    // their line now rather than leaving it to the timer, so the transcript
    // keeps the order the room spoke in.
    for (const other of Array.from(this.buffers.keys())) {
      if (other !== sttLabel) this.flush(other);
    }

    const buf = this.buffers.get(sttLabel) || {
      parts: [],
      start: event.start,
      // The first fragment's index. A later SpeakerRevision names the turns it
      // corrects by turn_order alone, and the line the user sees starts here.
      turnOrder: event.turnOrder,
      timer: null,
    };
    buf.parts.push(sanitized.text);
    buf.end = event.end;

    if (buf.timer) clearTimeout(buf.timer);
    buf.timer = setTimeout(() => this.flush(sttLabel), this.utteranceGapMs);
    // A pending utterance must never be the reason the process stays alive;
    // shutdown flushes explicitly.
    if (typeof buf.timer.unref === 'function') buf.timer.unref();

    this.buffers.set(sttLabel, buf);

    this.diarization.attributeTurn(sttLabel);

    // Keep the sentence standing while the speaker continues. Emitting a
    // partial here rather than a final is the whole trick: a committed fragment
    // must not clear the live line.
    this.protocol.emitPartial(
      buf.parts.join(' '),
      this.diarization.resolveLabel(sttLabel),
      sttLabel
    );
  }

  /**
   * Promote one speaker's accumulated fragments to a single Final.
   *
   * The display name is resolved here rather than when the first fragment
   * arrived: diarization may have matched the voice to a known speaker part-way
   * through the utterance, and the committed line should carry the better name.
   */
  flush(sttLabel) {
    const buf = this.buffers.get(sttLabel);
    if (!buf) return;

    if (buf.timer) clearTimeout(buf.timer);
    this.buffers.delete(sttLabel);

    const text = buf.parts.join(' ').trim();
    if (!text) return;

    const displayName = this.diarization.resolveLabel(sttLabel);
    this.protocol.emitFinal(text, displayName, sttLabel, buf.start, buf.end, buf.turnOrder);
    this.transcripts.save(displayName, text);
  }

  /**
   * Commit every in-flight utterance. Called by the shutdown sequence — without
   * it the last thing said in every meeting is dropped, since nothing else
   * arrives to trigger the gap timer.
   */
  flushAll() {
    for (const sttLabel of Array.from(this.buffers.keys())) this.flush(sttLabel);
  }

  /**
   * The text to show for this speaker right now: what they have already said in
   * this utterance, plus the words currently being recognised.
   */
  withBuffered(sttLabel, text) {
    const buf = this.buffers.get(sttLabel);
    if (!buf || buf.parts.length === 0) return text;
    return `${buf.parts.join(' ')} ${text}`.trim();
  }

  /**
   * Withdraw the partial a turn had already put on screen, for the two paths
   * that end a turn without producing anything to commit.
   *
   * The UI clears a partial when the matching final arrives. Returning early
   * from onFinal without saying anything left the turn's last words frozen in
   * the live pane, and a stuck partial there also suppressed every later one —
   * the "live transcript sometimes doesn't show" symptom. An empty-text Partial
   * is the withdrawal signal; it needs no new message type, and a consumer that
   * ignores it is no worse off than before.
   *
   * When an utterance is already in flight this withdraws nothing: one dropped
   * fragment must not wipe a sentence the speaker is still in the middle of, so
   * the accumulated text is re-sent instead.
   */
  retirePartial(sttLabel) {
    if (!sttLabel) return;
    const buf = this.buffers.get(sttLabel);
    this.protocol.emitPartial(
      buf ? buf.parts.join(' ') : '',
      this.diarization.resolveLabel(sttLabel),
      sttLabel
    );
  }
}

module.exports = { TranscriptPipeline, UTTERANCE_GAP_MS };
