/**
 * AI Meeting Interpreter — Diarization Layer
 *
 * Resolves STT speaker labels (e.g. "Speaker A") to display names:
 *
 *   1. In-session: an explicit rename wins for the rest of the session.
 *   2. Cross-session: a name previously persisted for that label.
 *   3. Cross-session by voice: MFCC embedding matched against stored
 *      embeddings by cosine similarity.
 *   4. Otherwise the raw STT label.
 *
 * Audio attribution
 * -----------------
 * The deframer sees raw PCM *before* STT has labelled it, so audio cannot be
 * filed under a speaker at push time. Instead every chunk lands in one pending
 * ring, and when a turn finalizes, everything captured since the previous final
 * is attributed to that turn's speaker. That is turn-accurate and needs no
 * provider timestamps — which the two providers report on different clocks.
 *
 * (Previously `pushAudio(sttLabel, chunk)` required a label the caller could not
 * have, so it was never called, the per-speaker rings were always empty, and
 * embedding extraction returned null on its first line every time.)
 */

'use strict';

const { log } = require('../infrastructure/logger.js');

const SIMILARITY_THRESHOLD = 0.85; // cosine sim above this → same speaker
const MAX_PENDING_CHUNKS = 40;     // ~10s at 250ms/chunk; caps memory per turn
const MIN_CHUNKS_FOR_EMBEDDING = 4; // ~1s of audio; below this MFCC is unreliable

class DiarizationLayer {
  /**
   * @param {Object} speakerRepository  saveSpeakerName / getSpeakerName /
   *                                    saveSpeakerEmbedding / getAllSpeakerEmbeddings
   * @param {Object} mfccExtractor      extractMFCC / cosineSimilarity
   */
  constructor(speakerRepository, mfccExtractor) {
    if (!speakerRepository) throw new TypeError('DiarizationLayer requires a speakerRepository');
    if (!mfccExtractor) throw new TypeError('DiarizationLayer requires an mfccExtractor');

    this.speakerRepository = speakerRepository;
    this.mfccExtractor = mfccExtractor;

    // sttLabel → { displayName, embedding, matched }
    this.sessionSpeakers = new Map();

    // Audio captured since the last finalized turn, awaiting attribution.
    this.pendingAudio = [];

    // Embeddings loaded once per session rather than re-read per turn.
    this.knownVoices = null;
  }

  // --- Public API --------------------------------------------------------------

  /**
   * Resolve an STT label to a display name.
   * @returns {string}
   */
  resolveLabel(sttLabel) {
    if (!sttLabel) return 'Speaker';
    return this.resolveOrCreateSlot(sttLabel).displayName;
  }

  /**
   * Buffer a PCM16 chunk. Attribution happens later, on the next final turn.
   * @param {Buffer} pcmChunk
   */
  pushAudio(pcmChunk) {
    if (!pcmChunk || pcmChunk.length === 0) return;
    this.pendingAudio.push(pcmChunk);
    if (this.pendingAudio.length > MAX_PENDING_CHUNKS) this.pendingAudio.shift();
  }

  /**
   * A turn finalized: attribute the buffered audio to its speaker, build a voice
   * embedding, and — if this label has no name yet — try to match it against a
   * known voice from a previous session.
   *
   * @param {string} sttLabel
   * @returns {Float32Array|null} the embedding, if one could be built
   */
  attributeTurn(sttLabel) {
    const chunks = this.pendingAudio;
    this.pendingAudio = [];

    if (!sttLabel || chunks.length < MIN_CHUNKS_FOR_EMBEDDING) return null;

    let embedding;
    try {
      embedding = this.mfccExtractor.extractMFCC(Buffer.concat(chunks));
    } catch (err) {
      log('warn', 'diarization', 'mfcc_extract_failed', { message: err.message });
      return null;
    }
    if (!embedding) return null;

    const slot = this.resolveOrCreateSlot(sttLabel);
    slot.embedding = embedding;

    // Only try voice matching while the label is still unnamed; once it has a
    // real name (persisted or renamed), that name wins.
    if (!slot.matched && slot.displayName === sttLabel) {
      const match = this.findClosestKnownSpeaker(embedding);
      if (match) {
        slot.displayName = match.displayName;
        slot.matched = true;
        log('info', 'diarization', 'voice_matched', {
          sttLabel,
          displayName: match.displayName,
          similarity: Number(match.similarity.toFixed(3)),
        });
      }
    }

    // One row per speaker per session. saveSpeakerEmbedding is a plain INSERT,
    // so persisting every turn grew speaker_embeddings without bound and — with
    // the cache dropped each time — forced a full re-read and JSON.parse of the
    // whole table on the next turn, quadratic in turn count.
    if (!slot.persisted) {
      this.speakerRepository.saveSpeakerEmbedding(
        sttLabel,
        slot.displayName,
        Array.from(embedding)
      );
      slot.persisted = true;
      this.invalidateKnownVoices();
    }

    return embedding;
  }

  /**
   * Rename an STT label. Persists so the name survives across sessions.
   * @returns {boolean} whether the rename was applied
   */
  rename(sttLabel, displayName) {
    const clean = String(displayName || '').trim().slice(0, 80);
    if (!sttLabel || !clean) return false;

    const slot = this.resolveOrCreateSlot(sttLabel);
    slot.displayName = clean;
    slot.matched = true; // an explicit name outranks any later voice match

    this.speakerRepository.saveSpeakerName(sttLabel, clean);
    // Relabel any embedding already stored for this voice, or loadKnownVoices
    // will keep skipping it as an unnamed candidate.
    this.speakerRepository.renameSpeakerEmbeddings(sttLabel, clean);
    this.invalidateKnownVoices();

    log('info', 'diarization', 'speaker_renamed', { sttLabel, displayName: clean });
    return true;
  }

  /**
   * Snapshot of in-session speakers, for a UI speaker list.
   * @returns {{sttLabel: string, displayName: string}[]}
   */
  getSessionSpeakers() {
    return [...this.sessionSpeakers.entries()].map(([sttLabel, slot]) => ({
      sttLabel,
      displayName: slot.displayName,
    }));
  }

  /**
   * Closest known speaker by cosine similarity, or null below threshold.
   * @param {Float32Array} embedding
   */
  findClosestKnownSpeaker(embedding) {
    if (!embedding) return null;

    let best = null;
    let bestSim = SIMILARITY_THRESHOLD;

    for (const voice of this.loadKnownVoices()) {
      const sim = this.mfccExtractor.cosineSimilarity(embedding, voice.vector);
      if (sim > bestSim) {
        bestSim = sim;
        best = { sttLabel: voice.sttLabel, displayName: voice.displayName, similarity: sim };
      }
    }
    return best;
  }

  // --- Private -----------------------------------------------------------------

  /**
   * Stored embeddings, parsed once and cached. Only rows whose display name is
   * a real name are candidates — matching a new voice to a previous session's
   * bare "Speaker A" would propagate a meaningless label.
   */
  loadKnownVoices() {
    if (this.knownVoices) return this.knownVoices;

    const voices = [];
    for (const row of this.speakerRepository.getAllSpeakerEmbeddings()) {
      if (!row.display_name || row.display_name === row.stt_label) continue;
      try {
        voices.push({
          sttLabel: row.stt_label,
          displayName: row.display_name,
          vector: new Float32Array(JSON.parse(row.embedding_json)),
        });
      } catch (_) {
        // Corrupt embedding row — skip it rather than failing the lookup.
      }
    }

    this.knownVoices = voices;
    return voices;
  }

  invalidateKnownVoices() {
    this.knownVoices = null;
  }

  resolveOrCreateSlot(sttLabel) {
    let slot = this.sessionSpeakers.get(sttLabel);
    if (slot) return slot;

    const saved = this.speakerRepository.getSpeakerName(sttLabel);
    slot = {
      displayName: saved || sttLabel,
      embedding: null,
      matched: Boolean(saved),
      persisted: false,
    };
    this.sessionSpeakers.set(sttLabel, slot);
    log('info', 'diarization', 'new_speaker', { sttLabel, displayName: slot.displayName });
    return slot;
  }
}

module.exports = { DiarizationLayer };
