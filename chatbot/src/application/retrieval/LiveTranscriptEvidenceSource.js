/**
 * LiveTranscriptEvidenceSource — EvidenceSource over the meeting currently
 * being recorded, if any.
 *
 * Not a database read: `liveContext` is a short rolling buffer of recent
 * lines the transport already received from the frontend for this one
 * question (see chat.rs / stdioSidecar.js), covering the gap between "just
 * spoken" and "indexed into chat_index.db" (FtsIndexBuilder rebuilds on a
 * staleness heuristic, not on every turn). No embedding call: the buffer is
 * short (tens of lines) and keyword overlap is enough to keep the current
 * question's relevant lines in the composite ranking.
 */

'use strict';

const MAX_LIVE_HITS = 8;

/** Lowercased word set, stripped of trivial punctuation. */
function wordsOf(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

class LiveTranscriptEvidenceSource {
  constructor() {
    this.name = 'live_transcript';
  }

  /**
   * @param {{question: string, liveContext?: string, limit?: number}} query
   * @returns {Promise<import('../../domain/ports/EvidenceSource').EvidenceHit[]>}
   */
  async search({ question, liveContext, limit = MAX_LIVE_HITS } = {}) {
    if (!liveContext || !String(liveContext).trim()) return [];

    const lines = String(liveContext)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return [];

    const questionWords = wordsOf(question || '');
    const scored = lines.map((line, idx) => {
      const lineWords = wordsOf(line);
      let overlap = 0;
      for (const w of questionWords) if (lineWords.has(w)) overlap += 1;
      return { line, idx, overlap };
    });

    // No overlap at all (e.g. a greeting or a first question) still returns
    // the most recent lines — "what did we just say" has no keyword to match.
    const anyOverlap = scored.some((s) => s.overlap > 0);
    const ranked = anyOverlap
      ? scored.sort((a, b) => b.overlap - a.overlap || b.idx - a.idx)
      : [...scored].reverse();

    return ranked.slice(0, limit).map((s) => {
      const colonIdx = s.line.indexOf(':');
      const speaker = colonIdx > 0 && colonIdx < 40 ? s.line.slice(0, colonIdx).trim() : '';
      const text = colonIdx > 0 && colonIdx < 40 ? s.line.slice(colonIdx + 1).trim() : s.line;
      return {
        sourceType: 'live',
        groupKey: 'live:current',
        sourceTable: 'live_transcript',
        sourceId: s.idx,
        meetingId: null,
        meetingDate: '',
        speaker,
        text,
        score: s.overlap,
      };
    });
  }
}

module.exports = { LiveTranscriptEvidenceSource };
