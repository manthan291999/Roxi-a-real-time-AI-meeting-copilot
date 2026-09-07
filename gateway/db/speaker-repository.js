/**
 * AI Meeting Interpreter — Speaker Identity Repository
 *
 * The four methods DiarizationLayer needs, and nothing else. Previously the
 * diarization layer was handed the entire 17-method db module; its constructor
 * parameter was already named `speakerRepository`, so the seam existed — this
 * is the object it was always meant to receive.
 *
 * Speaker identity is deliberately meeting-independent: names and voice
 * embeddings persist across sessions, which is the whole point of the feature.
 */

'use strict';

const { log } = require('../infrastructure/logger.js');

class SpeakerRepository {
  /** @param {import('better-sqlite3').Database} db */
  constructor(db) {
    this.db = db;
    this.stmts = {
      upsertName: db.prepare(`
        INSERT INTO speaker_names (stt_label, display_name, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (stt_label) DO UPDATE SET
          display_name = excluded.display_name,
          updated_at = CURRENT_TIMESTAMP
      `),
      getName: db.prepare('SELECT display_name FROM speaker_names WHERE stt_label = ?'),
      insertEmbedding: db.prepare(
        'INSERT INTO speaker_embeddings (stt_label, display_name, embedding_json) VALUES (?, ?, ?)'
      ),
      allEmbeddings: db.prepare(
        'SELECT stt_label, display_name, embedding_json FROM speaker_embeddings'
      ),
      renameEmbeddings: db.prepare(
        'UPDATE speaker_embeddings SET display_name = ? WHERE stt_label = ?'
      ),
    };
  }

  /** Persist a user-given display name for an STT label (cross-session). */
  saveSpeakerName(sttLabel, displayName) {
    try {
      this.stmts.upsertName.run(sttLabel, displayName);
    } catch (err) {
      log('warn', 'db', 'save_speaker_name_failed', { sttLabel, message: err.message });
    }
  }

  /** @returns {string|null} */
  getSpeakerName(sttLabel) {
    try {
      const row = this.stmts.getName.get(sttLabel);
      return row ? row.display_name : null;
    } catch (err) {
      log('warn', 'db', 'get_speaker_name_failed', { sttLabel, message: err.message });
      return null;
    }
  }

  /** Persist an MFCC embedding for cross-session voice matching. */
  saveSpeakerEmbedding(sttLabel, displayName, embeddingArray) {
    try {
      this.stmts.insertEmbedding.run(sttLabel, displayName, JSON.stringify(embeddingArray));
    } catch (err) {
      log('warn', 'db', 'save_embedding_failed', { sttLabel, message: err.message });
    }
  }

  /**
   * Relabel every embedding stored for an STT label.
   *
   * DiarizationLayer.loadKnownVoices skips rows whose display_name still equals
   * the stt_label, so without this a voice renamed after its embedding was
   * stored would never be matched in a later session.
   */
  renameSpeakerEmbeddings(sttLabel, displayName) {
    try {
      this.stmts.renameEmbeddings.run(displayName, sttLabel);
    } catch (err) {
      log('warn', 'db', 'rename_embeddings_failed', { sttLabel, message: err.message });
    }
  }

  /** @returns {{stt_label: string, display_name: string, embedding_json: string}[]} */
  getAllSpeakerEmbeddings() {
    try {
      return this.stmts.allEmbeddings.all();
    } catch (err) {
      log('warn', 'db', 'get_embeddings_failed', { message: err.message });
      return [];
    }
  }
}

module.exports = { SpeakerRepository };
