/**
 * Drops STT output that is noise rather than speech: hallucinated subtitle
 * boilerplate, sub-threshold confidence, and degenerate repetition.
 *
 * @implements {import('../interfaces/ITranscriptSanitizer')}
 */

// Matched against the whole trimmed utterance. Ordinary speech that is only
// noise when it is the entire turn — "thank you" was previously matched as a
// substring, so "thank you for shipping that, now the budget" was discarded.
const DEFAULT_EXACT_BLOCKLIST = Object.freeze(['thank you']);

// Matched anywhere in the utterance: unambiguous subtitle-hallucination
// markers, which are never part of real meeting speech.
const DEFAULT_BLOCKLIST = Object.freeze([
  'thanks for watching',
  'please subscribe',
  'subscribe to my channel',
  'amara.org',
  '\u5b57\u5e55',
  'subs by',
  'subtitles by',
]);

const DEFAULT_MIN_CONFIDENCE = 0.4;
const MIN_CHARS = 1;

class TranscriptSanitizer {
  /**
   * @param {{blocklist?: string[], exactBlocklist?: string[], minConfidence?: number}} [opts]
   *   Injectable so a deployment can tune the filter without editing this file,
   *   and so tests can exercise the thresholds directly.
   */
  constructor({
    blocklist = DEFAULT_BLOCKLIST,
    exactBlocklist = DEFAULT_EXACT_BLOCKLIST,
    minConfidence = DEFAULT_MIN_CONFIDENCE,
  } = {}) {
    this.blocklist = blocklist;
    this.exactBlocklist = exactBlocklist;
    this.minConfidence = minConfidence;
  }

  /**
   * @param {string} text 
   * @param {number} confidence 
   * @returns {{ok: boolean, text: string, reason?: string}}
   */
  sanitize(text, confidence) {
    if (!text || text.trim().length === 0) {
      return { ok: false, text, reason: 'empty_text' };
    }

    const lowerText = text.toLowerCase().trim();

    // Word count check
    if (lowerText.length < MIN_CHARS) {
      return { ok: false, text, reason: 'too_short' };
    }

    // Confidence check. Every provider is contractually required to supply this
    // (see interfaces/ISttProvider.js); a missing value is treated as a failure
    // to report rather than as full confidence.
    if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
      return { ok: false, text, reason: 'missing_confidence' };
    }
    if (confidence < this.minConfidence) {
      return { ok: false, text, reason: 'low_confidence' };
    }

    // Whole-utterance blocklist
    if (this.exactBlocklist.includes(lowerText)) {
      return { ok: false, text, reason: 'blocklist_phrase' };
    }

    // Substring blocklist
    for (const phrase of this.blocklist) {
      if (lowerText.includes(phrase)) {
        return { ok: false, text, reason: 'blocklist_phrase' };
      }
    }

    // Repetition check (same word 3+ times)
    const words = lowerText.split(/\s+/);
    if (words.length >= 3) {
      const allSame = words.every(w => w === words[0]);
      if (allSame) {
        return { ok: false, text, reason: 'repetitive_words' };
      }
    }

    return { ok: true, text };
  }
}

module.exports = {
  TranscriptSanitizer,
  DEFAULT_BLOCKLIST,
  DEFAULT_EXACT_BLOCKLIST,
  DEFAULT_MIN_CONFIDENCE,
};
