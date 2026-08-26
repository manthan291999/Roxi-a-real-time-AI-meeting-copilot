/**
 * AI Meeting Interpreter — Groq API Client
 *
 * Wraps the OpenAI-compatible Groq endpoint with:
 *  - per-call timeout (AbortSignal)
 *  - bounded retries with exponential backoff + jitter for 429/5xx/network
 *  - Retry-After header support
 *  - typed errors (GroqError) and latency/token accounting
 *
 * Auth errors (401/403) and other non-retryable 4xx are never retried.
 */

const { log, metrics, textPreview } = require('../infrastructure/logger.js');
const { getPool } = require('./groq-key-pool.js');
const { sleepMs, calculateBackoff, parseRetryAfterHeader } = require('../infrastructure/retry.js');

const { discovery } = require('./model-discovery.js');

const API_URL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
// Default model — can be overridden per-call via opts.model
// Falls back to dynamically discovered fast model, or a safe default.
const getDefaultModel = () => process.env.GROQ_MODEL || discovery.fastModel || 'openai/gpt-oss-20b';

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

class GroqError extends Error {
  constructor(message, { code = 'unknown', status = null, retryable = false, attempts = 1 } = {}) {
    super(message);
    this.name = 'GroqError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.attempts = attempts;
  }
}


/**
 * Call the Groq chat-completions endpoint.
 *
 * @param {Object} opts
 * @param {Array}  opts.messages    chat messages
 * @param {boolean} [opts.expectJson]  request JSON mode and parse the result
 * @param {number} [opts.timeoutMs=15000]
 * @param {number} [opts.retries=2] max retries after the first attempt
 * @param {number} [opts.temperature=0.1]
 * @param {number} [opts.maxTokens=1024]
 * @param {string} [opts.tag]       agent name, used in logs/metrics
 * @returns {Promise<{data:*, usage:{prompt_tokens:number|null,completion_tokens:number|null}, latencyMs:number, attempts:number}>}
 * @throws {GroqError}
 */
async function callGroq({
  messages,
  expectJson = false,
  timeoutMs = 15000,
  retries = 2,
  temperature = 0.1,
  maxTokens = 1024,
  tag = 'call',
  model,
}) {
  const pool = getPool();
  const resolvedModel = model || getDefaultModel();

  const bodyPayload = { model: resolvedModel, messages, temperature, max_tokens: maxTokens };
  if (expectJson) {
    bodyPayload.response_format = { type: 'json_object' };
  }

  let lastErr = null;
  // Each retry iteration picks the freshest healthy key from the pool.
  for (let attempt = 0; attempt <= retries; attempt++) {
    const slot = pool.getActiveSlot();
    if (!slot) {
      throw new GroqError('All Groq API keys are rate-limited (circuit open)', { code: 'all_keys_open' });
    }
    const { key, index: keyIndex } = slot;
    const started = Date.now();
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyPayload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const errText = (await res.text().catch(() => '')).slice(0, 300);
        const retryable = RETRYABLE_STATUS.has(res.status);
        lastErr = new GroqError(`Groq API error ${res.status}: ${errText}`, {
          code: `http_${res.status}`,
          status: res.status,
          retryable,
          attempts: attempt + 1,
        });
        // On 429, mark the key as failed so the pool rotates on the next attempt.
        if (res.status === 429) {
          pool.markFailure(keyIndex);
          log('warn', 'groq', 'key_429', { tag, keyIndex, attempt: attempt + 1 });
        }
        if (!retryable || attempt === retries) throw lastErr;
        const retryAfter = parseRetryAfterHeader(res.headers.get('retry-after'));
        await sleepMs(retryAfter != null ? retryAfter : calculateBackoff(attempt));
        continue;
      }

      const data = await res.json();
      const latencyMs = Date.now() - started;
      const usage = {
        prompt_tokens:     (data.usage && data.usage.prompt_tokens)     ?? null,
        completion_tokens: (data.usage && data.usage.completion_tokens) ?? null,
      };

      pool.markSuccess(keyIndex);
      metrics.observe('groq_latency_ms', latencyMs, { tag });
      if (usage.prompt_tokens     != null) metrics.observe('groq_tokens', usage.prompt_tokens,     { tag, kind: 'prompt' });
      if (usage.completion_tokens != null) metrics.observe('groq_tokens', usage.completion_tokens, { tag, kind: 'completion' });
      log('info', 'groq', 'call_ok', { tag, keyIndex, model: resolvedModel, latencyMs, attempts: attempt + 1, status: res.status });

      const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';

      if (expectJson) {
        try {
          return { data: JSON.parse(text), usage, latencyMs, attempts: attempt + 1, model: resolvedModel };
        } catch (_) {
          log('warn', 'groq', 'json_parse_failed', { tag, preview: textPreview(text, 40) });
          return { data: {}, usage, latencyMs, attempts: attempt + 1, model: resolvedModel };
        }
      }

      return { data: text.trim(), usage, latencyMs, attempts: attempt + 1, model: resolvedModel };
    } catch (err) {
      if (err instanceof GroqError && !err.retryable) throw err;
      lastErr = err instanceof GroqError
        ? err
        : new GroqError(err.message || String(err), {
            code: err.name === 'TimeoutError' ? 'timeout' : 'network',
            retryable: true,
            attempts: attempt + 1,
          });
      log('warn', 'groq', 'call_failed', {
        tag,
        code: lastErr.code,
        attempt: attempt + 1,
        retryable: lastErr.retryable,
        message: (lastErr.message || '').slice(0, 200),
      });
      if (attempt === retries) throw lastErr;
      await sleepMs(calculateBackoff(attempt));
    }
  }

  throw lastErr;
}

module.exports = { callGroq, GroqError, getDefaultModel };
