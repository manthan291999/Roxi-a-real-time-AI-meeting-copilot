/**
 * OpenAiLlmGateway — LlmGateway adapter using the OpenAI SDK directly.
 *
 * PRIMARY adapter. Mirrors the battle-tested semantics of the capture
 * pipeline's gateway/llm/openai-client.js because the project model
 * (gpt-5.6-luna) has parameter quirks:
 *   - temperature must NEVER be sent (the model requires its own default)
 *   - token cap goes through max_completion_tokens
 * Adds: budget gating, lenient JSON parsing, retry with backoff.
 */

const OpenAI = require('openai');
const { BudgetExhaustedError, ConfigError } = require('../../domain/errors');
const { parseJsonLoose } = require('./json-parse');

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

class OpenAiLlmGateway {
  /**
   * @param {{apiKey: string, model: string, baseUrl?: string, budget?: import('../../domain/ports/BudgetGuard').BudgetGuard, logger?: import('../../domain/ports/ChatLogger').ChatLogger, usageRecorder?: {record: Function}|null}} opts
   */
  constructor({ apiKey, model, baseUrl = '', budget = null, logger = null, usageRecorder = null }) {
    if (!apiKey) throw new ConfigError('OPENAI_API_KEY is missing (set it in gateway/.env or chatbot/.env)');
    this.modelName = model;
    this.budget = budget;
    this.logger = logger;
    this.usageRecorder = usageRecorder;
    this.client = new OpenAI({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });
  }

  model() {
    return this.modelName;
  }

  /** @param {import('../../domain/ports/LlmGateway').LlmCallOptions} opts */
  async complete({ messages, expectJson = false, maxTokens = 1024, timeoutMs = 30000, tag = 'call' }) {
    if (this.budget && !this.budget.canCall()) throw new BudgetExhaustedError();

    const callStarted = Date.now();
    // Shared fields for usage recording (success and failure paths).
    const usageBase = {
      source: 'chatbot', tag, provider: 'openai', endpoint: ENDPOINT,
      model: this.modelName, expectJson, maxTokens, timeoutMs, messages,
    };

    const params = {
      model: this.modelName,
      messages,
      max_completion_tokens: maxTokens,
      // NOTE: temperature intentionally omitted — gpt-5.6-luna rejects overrides.
    };
    if (expectJson) params.response_format = { type: 'json_object' };

    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const started = Date.now();
      try {
        const completion = await this.client.chat.completions.create(params, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        const latencyMs = Date.now() - started;
        const text = completion.choices?.[0]?.message?.content || '';
        const usage = {
          prompt_tokens: completion.usage?.prompt_tokens ?? null,
          completion_tokens: completion.usage?.completion_tokens ?? null,
        };
        this.budget?.recordCall();
        this.logger?.info('llm', 'call_ok', { tag, model: this.modelName, latencyMs, attempt: attempt + 1 });
        this.usageRecorder?.record({ ...usageBase, status: 'ok', usage,
          attempts: attempt + 1, latencyMs: Date.now() - callStarted, responsePreview: text });

        if (expectJson) {
          return { data: parseJsonLoose(text), raw: text, latencyMs, model: this.modelName, usage };
        }
        return { data: text.trim(), raw: text, latencyMs, model: this.modelName, usage };
      } catch (err) {
        lastErr = err;
        const status = err?.status || err?.code || 'network';
        this.logger?.warn('llm', 'call_failed', {
          tag, status, attempt: attempt + 1, message: String(err.message).slice(0, 200),
        });
        const retryable = RETRYABLE_STATUS.has(err?.status) || err?.name === 'TimeoutError' || err?.cause?.code === 'ETIMEDOUT';
        if (!retryable) {
          this.usageRecorder?.record({ ...usageBase, status: 'failed', errorCode: status,
            errorMessage: err?.message, attempts: attempt + 1, latencyMs: Date.now() - callStarted });
          throw err;
        }
        if (attempt < MAX_RETRIES) await sleep(300 * Math.pow(2, attempt));
      }
    }
    this.usageRecorder?.record({ ...usageBase, status: 'failed',
      errorCode: lastErr?.status || lastErr?.code || 'network',
      errorMessage: lastErr?.message, attempts: MAX_RETRIES + 1, latencyMs: Date.now() - callStarted });
    throw lastErr;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { OpenAiLlmGateway };
