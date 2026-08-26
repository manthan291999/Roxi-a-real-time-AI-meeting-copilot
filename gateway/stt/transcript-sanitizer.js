/**
 * @implements {import('../interfaces/ITranscriptSanitizer')}
 */
class TranscriptSanitizer {
  constructor() {
    this.blocklist = [
      'thank you',
      'thanks for watching',
      'please subscribe',
      'subscribe to my channel',
      'amara.org',
      '字幕',
      'subs by',
      'subtitles by'
    ];
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
    const wordCount = lowerText.split(/\s+/).length;
    if (wordCount < 2) {
      return { ok: false, text, reason: 'too_short' };
    }

    // Confidence check
    if (confidence < 0.40) {
      return { ok: false, text, reason: 'low_confidence' };
    }

    // Blocklist check
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

module.exports = new TranscriptSanitizer();
