const { callLLM } = require('../llm/openai-client.js');
const { AGENT_CONFIG } = require('../config/agent-config.js');
const { log } = require('../infrastructure/logger.js');

class TranscriptCleaner {
  constructor() {
    this.config = AGENT_CONFIG.transcript_cleaner;
  }

  async clean(text) {
    const messages = [
      { role: 'system', content: `You are an AI transcript cleaner operating within a real-time STT pipeline.` },
      { role: 'user', content: `## Objective
Evaluate the following STT transcript chunk to determine if it is a hallucination/noise,
non-English, or clean English.

## Input
Transcript chunk: "${text}"

## Rules
1. If it's an obvious hallucination (e.g., "Thanks for watching!", "Please subscribe", subtitle credits, weird repeated noises like "Um um um um"): output DROP.
2. If it is mostly non-English text: output TRANSLATE and provide the English translation.
3. If it is valid, normal English meeting speech: output KEEP and provide the exact original text.

## Output Format
Return strictly valid JSON matching this schema exactly:
{
  "action": "keep" | "drop" | "translate",
  "text": "The final english text (empty if dropped)",
  "reason": "Brief reason for your decision"
}

## Safety / Validation
Before outputting, verify:
1. The JSON is perfectly valid.
2. You only DROP if it is clearly garbage or STT hallucination.` }
    ];

    try {
      const result = await callLLM({
        messages,
        expectJson: true,
        tag: 'transcript_cleaner',
        ...this.config
      });

      if (!result || !result.data) {
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
