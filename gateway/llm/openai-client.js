const OpenAI = require('openai');
const { log, metrics } = require('../infrastructure/logger.js');
const { sleepMs, calculateBackoff } = require('../infrastructure/retry.js');

const MODEL = 'gpt-5.6-luna'; // locked — no override

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504]);

async function callLLM({ messages, expectJson=false, timeoutMs=15000,
                          maxTokens=512, temperature=0.1, tag='call', retries=2 }) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    try {
      const params = { model: MODEL, messages, temperature, max_tokens: maxTokens };
      if (expectJson) params.response_format = { type: 'json_object' };

      const completion = await client.chat.completions.create(params,
        { signal: AbortSignal.timeout(timeoutMs) });

      const latencyMs = Date.now() - started;
      const usage = {
        prompt_tokens:     completion.usage?.prompt_tokens     ?? null,
        completion_tokens: completion.usage?.completion_tokens ?? null,
      };
      const text = completion.choices?.[0]?.message?.content || '';

      metrics.observe('llm_latency_ms', latencyMs, { tag });
      log('info', 'llm', 'call_ok', { tag, model: MODEL, latencyMs, attempts: attempt + 1 });

      if (expectJson) {
        try { return { data: JSON.parse(text), usage, latencyMs, attempts: attempt+1, model: MODEL }; }
        catch (_) { return { data: {}, usage, latencyMs, attempts: attempt+1, model: MODEL }; }
      }
      return { data: text.trim(), usage, latencyMs, attempts: attempt+1, model: MODEL };

    } catch (err) {
      lastErr = err;
      const code = err?.status || err?.code || 'network';
      log('warn', 'llm', 'call_failed', { tag, code, attempt: attempt+1, message: String(err.message).slice(0,200) });
      if (!RETRYABLE_CODES.has(err?.status) && err?.name !== 'TimeoutError') throw err;
      if (attempt < retries) await sleepMs(calculateBackoff(attempt));
    }
  }
  throw lastErr;
}

module.exports = { callLLM, MODEL };
