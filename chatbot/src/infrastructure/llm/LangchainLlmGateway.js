/**
 * LangchainLlmGateway — LlmGateway adapter using LangChain ChatOpenAI.
 *
 * ALTERNATIVE adapter (enable with CHATBOT_LLM_ADAPTER=langchain). Best for
 * standard OpenAI-compatible models. For quirk-sensitive models (e.g.
 * gpt-5.6-luna rejecting temperature), use the default OpenAiLlmGateway.
 *
 * Interchangeable with OpenAiLlmGateway behind the LlmGateway port (LSP).
 */

const { ChatOpenAI } = require('@langchain/openai');
const { BudgetExhaustedError, ConfigError } = require('../../domain/errors');
const { parseJsonLoose } = require('./json-parse');

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

class LangchainLlmGateway {
  /**
   * @param {{apiKey: string, model: string, baseUrl?: string, budget?: import('../../domain/ports/BudgetGuard').BudgetGuard, logger?: import('../../domain/ports/ChatLogger').ChatLogger, usageRecorder?: {record: Function}|null}} opts
   */
  constructor({ apiKey, model, baseUrl = '', budget = null, logger = null, usageRecorder = null }) {
    if (!apiKey) throw new ConfigError('OPENAI_API_KEY is missing (set it in gateway/.env or chatbot/.env)');
    this.modelName = model;
    this.budget = budget;
    this.logger = logger;
    this.usageRecorder = usageRecorder;
    this.chat = new ChatOpenAI({
      apiKey,
      model,
      // Do not set temperature: keeps provider default (quirk-safe).
      maxRetries: 2,
      ...(baseUrl ? { configuration: { baseURL: baseUrl } } : {}),
    });
  }

  model() {
    return this.modelName;
  }

  /** @param {import('../../domain/ports/LlmGateway').LlmCallOptions} opts */
  async complete({ messages, expectJson = false, maxTokens = 1024, timeoutMs = 30000, tag = 'call' }) {
    if (this.budget && !this.budget.canCall()) throw new BudgetExhaustedError();

    const started = Date.now();
    const kwargs = { max_completion_tokens: maxTokens };
    if (expectJson) kwargs.response_format = { type: 'json_object' };

    const runnable = this.chat.bind(kwargs);
    let res;
    try {
      res = await Promise.race([
        runnable.invoke(messages),
        timeout(timeoutMs),
      ]);
    } catch (err) {
      this.usageRecorder?.record({
        source: 'chatbot', tag, provider: 'openai', endpoint: ENDPOINT,
        model: this.modelName, expectJson, maxTokens, timeoutMs, messages,
        status: 'failed',
        errorCode: err?.status || err?.code || 'network',
        errorMessage: err?.message,
        attempts: 1,
        latencyMs: Date.now() - started,
      });
      throw err;
    }

    const latencyMs = Date.now() - started;
    const text = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
    const usage = extractUsage(res);
    this.budget?.recordCall();
    this.logger?.info('llm', 'call_ok', { tag, model: this.modelName, latencyMs, adapter: 'langchain' });
    this.usageRecorder?.record({
      source: 'chatbot', tag, provider: 'openai', endpoint: ENDPOINT,
      model: this.modelName, expectJson, maxTokens, timeoutMs, messages,
      status: 'ok', usage, attempts: 1, latencyMs, responsePreview: text,
    });

    if (expectJson) return { data: parseJsonLoose(text), raw: text, latencyMs, model: this.modelName, usage };
    return { data: text.trim(), raw: text, latencyMs, model: this.modelName, usage };
  }
}

/**
 * Extract token usage from a LangChain AIMessage. Depending on SDK version it
 * lives in response_metadata.tokenUsage / response_metadata.token_usage or in
 * usage_metadata. Returns nulls when the provider did not report usage.
 */
function extractUsage(res) {
  const meta = res?.response_metadata?.tokenUsage || res?.response_metadata?.token_usage || {};
  const alt = res?.usage_metadata || {};
  return {
    prompt_tokens: meta.promptTokens ?? meta.prompt_tokens ?? alt.input_tokens ?? null,
    completion_tokens: meta.completionTokens ?? meta.completion_tokens ?? alt.output_tokens ?? null,
  };
}

function timeout(ms) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`LLM call timed out after ${ms}ms`)), ms)
  );
}

module.exports = { LangchainLlmGateway };
