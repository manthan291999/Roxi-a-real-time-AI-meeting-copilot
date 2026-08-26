/**
 * AI Meeting Interpreter — Diarization Layer
 *
 * Sits between ProviderManager and the semantic buffer. Receives STT speaker
 * labels (e.g. "Speaker_0") and resolves them to display names:
 *
 *   1. Within-session: trust AssemblyAI/Speechmatics speaker labels directly.
 *   2. Across sessions: look up speaker_names table for a user-given name.
 *   3. MFCC matching (optional): if audio chunks are provided, compare voice
 *      embeddings to cross-session speaker identity (experimental).
 *   4. Rename: the UI emits a "rename_speaker" command; this layer persists
 *      the mapping and broadcasts a SpeakerRenamed event.
 *
 * Usage (in sidecar.js):
 *   const { DiarizationLayer } = require('./diarization-layer.js');
 *   const diarization = new DiarizationLayer(db);
 *   const displayName = diarization.resolveLabel('Speaker_0');
 *   diarization.rename('Speaker_0', 'Alice');
 */

'use strict';

const { log } = require('../infrastructure/logger.js');

const SIMILARITY_THRESHOLD = 0.85;  // cosine sim above this → same speaker
const MAX_AUDIO_RING       = 30;    // max PCM chunks kept per STT speaker label

class DiarizationLayer {
  /**
   * @param {Object} db  db.js module reference (must have speakerName methods)
   */
  constructor(speakerRepository, { mfccExtractor } = {}) {
    this.speakerRepository = speakerRepository;
    this.mfccExtractor = mfccExtractor || require('../providers/mfcc.js');

    // In-session state
    // sttLabel → { displayName: string, audioRing: Buffer[], embedding: Float32Array|null }
    this.sessionSpeakers = new Map();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Resolve an STT label to a display name.
   * Checks: (1) in-session rename, (2) persisted DB name, (3) raw label.
   *
   * @param {string} sttLabel  e.g. "Speaker_0"
   * @returns {string}         display name, e.g. "Alice" or "Speaker_0"
   */
  resolveLabel(sttLabel) {
    if (!sttLabel) return 'Speaker';
    const slot = this.resolveOrCreateSlot(sttLabel);
    return slot.displayName;
  }

  /**
   * Feed a PCM16 audio chunk associated with an STT speaker label.
   * Keeps the most recent MAX_AUDIO_RING chunks for MFCC extraction.
   *
   * @param {string} sttLabel
   * @param {Buffer} pcmChunk  raw PCM16 bytes
   */
  pushAudio(sttLabel, pcmChunk) {
    const slot = this.resolveOrCreateSlot(sttLabel);
    slot.audioRing.push(pcmChunk);
    if (slot.audioRing.length > MAX_AUDIO_RING) slot.audioRing.shift();
  }

  /**
   * Extract MFCC embedding from the accumulated audio ring for a speaker.
   * Stores it in the slot for future cross-session matching.
   *
   * @param {string} sttLabel
   * @returns {Float32Array|null}
   */
  buildEmbedding(sttLabel) {
    const slot = this.resolveOrCreateSlot(sttLabel);
    if (slot.audioRing.length === 0) return null;

    const combined = Buffer.concat(slot.audioRing);
    const vec = this.mfccExtractor.extractMFCC(combined);
    if (vec) {
      slot.embedding = vec;
      // Persist embedding to DB (fire-and-forget, non-critical)
      try {
        this.speakerRepository.saveSpeakerEmbedding(sttLabel, slot.displayName, Array.from(vec));
      } catch (_) { /* db not ready or table missing — safe to ignore */ }
    }
    return vec;
  }

  /**
   * Rename an STT label to a user-given display name.
   * Persists to DB so the name survives across sessions.
   *
   * @param {string} sttLabel     e.g. "Speaker_0"
   * @param {string} displayName  e.g. "Alice"
   */
  rename(sttLabel, displayName) {
    const clean = (displayName || '').trim().slice(0, 80);
    if (!clean) return;
    const slot = this.resolveOrCreateSlot(sttLabel);
    slot.displayName = clean;

    try {
      this.speakerRepository.saveSpeakerName(sttLabel, clean);
    } catch (err) {
      log('warn', 'diarization', 'rename_persist_failed', { sttLabel, message: err.message });
    }

    log('info', 'diarization', 'speaker_renamed', { sttLabel, displayName: clean });
  }

  /**
   * Return a snapshot of all in-session speakers for the UI SpeakerList.
   * @returns {{ sttLabel: string, displayName: string }[]}
   */
  getSessionSpeakers() {
    return [...this.sessionSpeakers.entries()].map(([sttLabel, slot]) => ({
      sttLabel,
      displayName: slot.displayName,
    }));
  }

  /**
   * Cross-session MFCC matching: find the closest known speaker in the DB
   * by cosine similarity. Returns null if no match above threshold.
   *
   * @param {Float32Array} embedding  query embedding
   * @returns {{ sttLabel: string, displayName: string, similarity: number }|null}
   */
  findClosestKnownSpeaker(embedding) {
    if (!embedding) return null;
    let best = null;
    let bestSim = SIMILARITY_THRESHOLD;

    try {
      const known = this.speakerRepository.getAllSpeakerEmbeddings();
      for (const row of known) {
        let vec;
        try { vec = new Float32Array(JSON.parse(row.embedding_json)); }
        catch (_) { continue; }
        const sim = this.mfccExtractor.cosineSimilarity(embedding, vec);
        if (sim > bestSim) {
          bestSim = sim;
          best = { sttLabel: row.stt_label, displayName: row.display_name, similarity: sim };
        }
      }
    } catch (_) { /* DB not ready */ }

    return best;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  resolveOrCreateSlot(sttLabel) {
    if (!this.sessionSpeakers.has(sttLabel)) {
      // Try to load a persisted name from DB
      let displayName = sttLabel;
      try {
        const saved = this.speakerRepository.getSpeakerName(sttLabel);
        if (saved) displayName = saved;
      } catch (_) { /* DB not ready */ }

      this.sessionSpeakers.set(sttLabel, { displayName, audioRing: [], embedding: null });
      log('info', 'diarization', 'new_speaker', { sttLabel, displayName });
    }
    return this.sessionSpeakers.get(sttLabel);
  }
}

module.exports = { DiarizationLayer };
