const OpenAI = require('openai');
const { log, metrics } = require('../infrastructure/logger.js');
const { sleepMs, calculateBackoff } = require('../infrastructure/retry.js');
const usageStore = require('../infrastructure/usage-store.js');

const MODEL = 'gpt-5.6-luna'; // locked — no override
const PROVIDER = 'openai';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504]);

async function callLLM({ messages, expectJson=false, timeoutMs=15000,
                          maxTokens=512, temperature=0.1, tag='call', retries=2 }) {
  const callStarted = Date.now();
  // Shared fields for usage-store records (success and failure paths).
  const usageBase = { source: 'gateway', tag, provider: PROVIDER, endpoint: ENDPOINT,
                      model: MODEL, expectJson, maxTokens, timeoutMs, messages };
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    try {
      // gpt-5.6-luna strictly requires default temperature (1) and fails if it is specified as anything else.
      // So we omit it entirely.
      const params = { model: MODEL, messages, max_completion_tokens: maxTokens };
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

      // Persist per-request usage for the developer dashboard (never throws).
      usageStore.record({ ...usageBase, status: 'ok', usage,
        attempts: attempt + 1, latencyMs: Date.now() - callStarted, responsePreview: text });

      if (expectJson) {
        try { return { data: JSON.parse(text), usage, latencyMs, attempts: attempt+1, model: MODEL }; }
        catch (_) { return { data: {}, usage, latencyMs, attempts: attempt+1, model: MODEL }; }
      }
      return { data: text.trim(), usage, latencyMs, attempts: attempt+1, model: MODEL };

    } catch (err) {
      lastErr = err;
      const code = err?.status || err?.code || 'network';
      log('warn', 'llm', 'call_failed', { tag, code, attempt: attempt+1, message: String(err.message).slice(0,200) });
      if (!RETRYABLE_CODES.has(err?.status) && err?.name !== 'TimeoutError') {
        usageStore.record({ ...usageBase, status: 'failed', errorCode: code,
          errorMessage: err?.message, attempts: attempt + 1, latencyMs: Date.now() - callStarted });
        throw err;
      }
      if (attempt < retries) await sleepMs(calculateBackoff(attempt));
    }
  }
  usageStore.record({ ...usageBase, status: 'failed',
    errorCode: lastErr?.status || lastErr?.code || 'network',
    errorMessage: lastErr?.message, attempts: retries + 1, latencyMs: Date.now() - callStarted });
  throw lastErr;
}

module.exports = { callLLM, MODEL };
