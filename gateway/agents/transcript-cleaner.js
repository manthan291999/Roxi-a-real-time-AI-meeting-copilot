const { callGroq } = require('../llm/groq-client');
const { AGENT_CONFIG } = require('../config/agent-config');
const { log } = require('../infrastructure/logger');

/**
 * @implements {import('../interfaces/ITranscriptCleaner')}
 */
class TranscriptCleaner {
  constructor() {
    this.config = AGENT_CONFIG.transcript_cleaner;
  }

  /**
   * @param {string} text 
   * @returns {Promise<{action: 'keep'|'drop'|'translate', text: string, reason?: string}>}
   */
  async clean(text) {
    const prompt = `You are an AI transcript cleaner.
Your job is to evaluate the following STT transcript chunk and determine if it is a hallucination/noise, non-English, or clean English.

Rules:
1. If it's obvious hallucination (e.g., "Thanks for watching!", "Please subscribe", subtitle credits, weird repeated noises like "Um um um um"): output DROP.
2. If it is mostly non-English text: output TRANSLATE and provide the English translation.
3. If it is valid, normal English meeting speech: output KEEP and provide the exact original text.

Format your response exactly as JSON:
{
  "action": "keep" | "drop" | "translate",
  "text": "The final english text (empty if dropped)",
  "reason": "Brief reason for your decision"
}

Transcript chunk:
"${text}"
`;

    try {
      const result = await callGroq({
        model: this.config.model,
        messages: [{ role: 'user', content: prompt }],
        jsonMode: true,
        timeoutMs: this.config.timeoutMs
      });

      if (!result || !result.data) {
        // Fallback to keep if LLM fails
        return { action: 'keep', text, reason: 'llm_fallback' };
      }

      return result.data;
    } catch (err) {
      log('error', 'transcript-cleaner', 'llm_error', { error: err.message });
      return { action: 'keep', text, reason: 'llm_error_fallback' };
    }
  }
}

module.exports = new TranscriptCleaner();
