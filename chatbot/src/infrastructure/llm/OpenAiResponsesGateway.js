/**
 * OpenAiResponsesGateway — WebSearchGateway adapter over the OpenAI
 * Responses API with a hosted web-search tool attached.
 *
 * The tool is OFFERED, never forced (unless toolChoice==='required'): the
 * model decides inside this single call whether the question needs the web.
 * That is the whole point of the feature — there is no classifier turn.
 *
 * Mirrors OpenAiLlmGateway's conventions on purpose so the two adapters stay
 * readable side by side: budget gate first, retry with backoff on the same
 * status set, usage recorded on BOTH the success and the failure path, and
 * `temperature` never sent (project-wide rule for the premium model).
 *
 * Two deliberate differences from OpenAiLlmGateway:
 *   - PLAIN TEXT, never response_format/json_schema. URL citations come back
 *     as character offsets into the returned text; wrap that text in a JSON
 *     envelope and every offset addresses the serialised JSON instead of the
 *     prose, so the [W#] tokens land mid-word or inside a string literal.
 *   - A longer default timeout. A multi-search turn routinely exceeds the
 *     30s that is generous for a plain completion.
 */

const OpenAI = require('openai');
const { BudgetExhaustedError, ConfigError } = require('../../domain/errors');

const ENDPOINT = 'https://api.openai.com/v1/responses';
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;

/**
 * The tool id this SDK version types (4.104.0 knows only the preview name).
 * Used as the one-time fallback when the configured id is rejected.
 */
const FALLBACK_TOOL_TYPE = 'web_search_preview';

class OpenAiResponsesGateway {
  /**
   * @param {{apiKey: string, model: string, baseUrl?: string,
   *          toolType?: string, contextSize?: 'low'|'medium'|'high',
   *          maxToolCalls?: number, userLocation?: Object|null, timeoutMs?: number,
   *          budget?: import('../../domain/ports/BudgetGuard').BudgetGuard,
   *          logger?: import('../../domain/ports/ChatLogger').ChatLogger,
   *          usageRecorder?: {record: Function}|null}} opts
   */
  constructor({
    apiKey,
    model,
    baseUrl = '',
    toolType = 'web_search',
    contextSize = 'medium',
    maxToolCalls = 0,
    userLocation = null,
    timeoutMs = 60000,
    budget = null,
    logger = null,
    usageRecorder = null,
  }) {
    if (!apiKey) throw new ConfigError('OPENAI_API_KEY is missing (set it in the root .env)');
    this.modelName = model;
    this.toolType = toolType;
    this.contextSize = contextSize;
    this.maxToolCalls = Number.isFinite(maxToolCalls) ? maxToolCalls : 0;
    this.userLocation = userLocation;
    this.defaultTimeoutMs = timeoutMs;
    this.budget = budget;
    this.logger = logger;
    this.usageRecorder = usageRecorder;
    this.client = new OpenAI({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });
  }

  model() {
    return this.modelName;
  }

  /** @param {import('../../domain/ports/WebSearchGateway').WebAnswerRequest} req */
  async answer({
    messages,
    toolChoice = 'auto',
    maxTokens = 1800,
    timeoutMs = this.defaultTimeoutMs,
    tag = 'web_call',
  }) {
    if (this.budget && !this.budget.canCall()) throw new BudgetExhaustedError();

    const callStarted = Date.now();
    const usageBase = {
      source: 'chatbot', tag, provider: 'openai', endpoint: ENDPOINT,
      model: this.modelName, expectJson: false, maxTokens, timeoutMs, messages,
    };

    let lastErr = null;
    let toolTypeSwapped = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const started = Date.now();
      try {
        const res = await this.client.responses.create(this._params({ messages, toolChoice, maxTokens }), {
          signal: AbortSignal.timeout(timeoutMs),
        });

        const parsed = this._parse(res);
        const latencyMs = Date.now() - started;

        this.budget?.recordCall();
        this.logger?.info('web_llm', 'call_ok', {
          tag, model: this.modelName, latencyMs, attempt: attempt + 1,
          usedWebSearch: parsed.usedWebSearch, searchCalls: parsed.searchCalls,
          citations: parsed.citations.length,
        });
        this.usageRecorder?.record({
          ...usageBase, status: 'ok', usage: parsed.usage,
          attempts: attempt + 1, latencyMs: Date.now() - callStarted,
          responsePreview: parsed.answer,
        });

        return { ...parsed, latencyMs, model: this.modelName };
      } catch (err) {
        lastErr = err;
        const status = err?.status || err?.code || 'network';
        this.logger?.warn('web_llm', 'call_failed', {
          tag, status, attempt: attempt + 1, toolType: this.toolType,
          message: String(err?.message || '').slice(0, 200),
        });

        // The tool id has moved before. Swap once, in-process, and retry —
        // this is the only hard dependency on an API naming detail.
        if (!toolTypeSwapped && this._isToolTypeRejection(err)) {
          toolTypeSwapped = true;
          this.logger?.info('web_llm', 'tool_type_fallback', {
            from: this.toolType, to: FALLBACK_TOOL_TYPE,
          });
          this.toolType = FALLBACK_TOOL_TYPE;
          continue; // does not consume a retry slot on purpose
        }

        const retryable = RETRYABLE_STATUS.has(err?.status)
          || err?.name === 'TimeoutError'
          || err?.cause?.code === 'ETIMEDOUT';
        if (!retryable) {
          this.usageRecorder?.record({
            ...usageBase, status: 'failed', errorCode: status,
            errorMessage: err?.message, attempts: attempt + 1,
            latencyMs: Date.now() - callStarted,
          });
          throw err;
        }
        if (attempt < MAX_RETRIES) await sleep(400 * Math.pow(2, attempt));
      }
    }

    this.usageRecorder?.record({
      ...usageBase, status: 'failed',
      errorCode: lastErr?.status || lastErr?.code || 'network',
      errorMessage: lastErr?.message, attempts: MAX_RETRIES + 1,
      latencyMs: Date.now() - callStarted,
    });
    throw lastErr;
  }

  /** Build the request body. Split out so a test can assert on it. */
  _params({ messages, toolChoice, maxTokens }) {
    const list = Array.isArray(messages) ? messages : [];
    // Every system message becomes `instructions`; the rest are input turns.
    const instructions = list
      .filter((m) => m && m.role === 'system')
      .map((m) => String(m.content || ''))
      .join('\n\n');
    const input = list
      .filter((m) => m && m.role !== 'system' && typeof m.content === 'string' && m.content.trim())
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const tool = { type: this.toolType };
    if (this.contextSize) tool.search_context_size = this.contextSize;
    if (this.userLocation) tool.user_location = this.userLocation;

    const params = {
      model: this.modelName,
      input,
      tools: [tool],
      max_output_tokens: maxTokens,
      // NOTE: temperature intentionally omitted — project-wide rule.
      // NOTE: no text.format / json_schema — see the class doc comment.
    };
    if (instructions) params.instructions = instructions;
    // 'required' rather than {type: toolType}: it is tool-id agnostic, which
    // matters precisely because the id above can be swapped at runtime.
    if (toolChoice === 'required') params.tool_choice = 'required';
    // Absent from SDK 4.104.0's types; sent only when explicitly configured,
    // so an API that rejects the unknown parameter is opt-in, not the default.
    if (this.maxToolCalls > 0) params.max_tool_calls = this.maxToolCalls;

    return params;
  }

  /**
   * Pull the three things that matter out of a Responses payload.
   *
   * `usedWebSearch` is counted from web_search_call output items — the ground
   * truth for every metric this feature reports. Never infer it from the prose.
   */
  _parse(res) {
    const output = Array.isArray(res?.output) ? res.output : [];
    let searchCalls = 0;
    let text = '';
    const citations = [];

    for (const item of output) {
      if (!item || typeof item !== 'object') continue;
      if (item.type === 'web_search_call') {
        searchCalls += 1;
        continue;
      }
      if (item.type !== 'message') continue;

      for (const part of Array.isArray(item.content) ? item.content : []) {
        if (!part || part.type !== 'output_text') continue;
        // Annotation offsets are relative to THIS part's text, so rebase them
        // onto the concatenated answer before keeping them.
        const base = text.length;
        const partText = String(part.text || '');
        text += partText;

        for (const ann of Array.isArray(part.annotations) ? part.annotations : []) {
          if (!ann || ann.type !== 'url_citation' || !ann.url) continue;
          const start = Number.isFinite(ann.start_index) ? ann.start_index : partText.length;
          const end = Number.isFinite(ann.end_index) ? ann.end_index : partText.length;
          citations.push({
            title: String(ann.title || ''),
            url: String(ann.url),
            startIndex: base + Math.max(0, Math.min(start, partText.length)),
            endIndex: base + Math.max(0, Math.min(end, partText.length)),
          });
        }
      }
    }

    // output_text is the SDK's convenience getter. Used only as a fallback:
    // the walk above is what keeps offsets aligned with the text we keep.
    const answer = (text || String(res?.output_text || '')).trim();

    return {
      answer,
      citations,
      usedWebSearch: searchCalls > 0,
      searchCalls,
      // The Responses API reports input_tokens/output_tokens; UsageRecorder
      // reads prompt_tokens/completion_tokens. Mapped here or every web call
      // records zero cost and the dashboard silently under-reports.
      usage: {
        prompt_tokens: res?.usage?.input_tokens ?? null,
        completion_tokens: res?.usage?.output_tokens ?? null,
      },
    };
  }

  /** Is this the API telling us it does not know our tool id? */
  _isToolTypeRejection(err) {
    if (err?.status !== 400) return false;
    const msg = String(err?.message || '').toLowerCase();
    return msg.includes(this.toolType.toLowerCase())
      || (msg.includes('tool') && (msg.includes('unknown') || msg.includes('invalid') || msg.includes('not supported')));
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { OpenAiResponsesGateway, FALLBACK_TOOL_TYPE };
