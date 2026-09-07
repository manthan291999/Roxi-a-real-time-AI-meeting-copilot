/**
 * OpenAiEmbeddingGateway — EmbeddingGateway adapter over the OpenAI SDK.
 *
 * Mirrors OpenAiLlmGateway's operational semantics (budget gate, retry with
 * backoff on 429/5xx, usage recording) because the same things go wrong; it is
 * a separate class rather than a shared base because the two call different
 * endpoints with different payload shapes, and merging them would couple the
 * chat budget to the upload budget.
 *
 * Cost, for scale: text-embedding-3-small is $0.02 per 1M input tokens, so a
 * 100-page PDF (~200 chunks, ~102k tokens) is about $0.002 and a query
 * embedding (~20 tokens) is effectively free.
 */

'use strict';

const OpenAI = require('openai');
const { ConfigError, BudgetExhaustedError, DocumentError } = require('../../domain/errors');

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;
const ENDPOINT = 'https://api.openai.com/v1/embeddings';

/**
 * Inputs per HTTP request. The API accepts up to 2,048, but smaller batches
 * bound the blast radius of a retry and keep progress events frequent enough
 * to be useful: a 200-chunk document reports four times, not once.
 */
const BATCH_SIZE = 64;

/** text-embedding-3-small's native width. */
const DEFAULT_DIMENSIONS = 1536;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Scale to unit length in place.
 *
 * OpenAI's v3 embedding models already return normalized vectors, but this
 * does not depend on that: the dot-product-as-cosine assumption in
 * DocumentRepository has to hold whatever the provider does.
 */
function normalize(values) {
  const v = Float32Array.from(values);
  let sumSquares = 0;
  for (let i = 0; i < v.length; i++) sumSquares += v[i] * v[i];
  const norm = Math.sqrt(sumSquares);
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) v[i] /= norm;
  }
  return v;
}

class OpenAiEmbeddingGateway {
  /**
   * @param {Object} opts
   * @param {string} opts.apiKey
   * @param {string} [opts.model]
   * @param {string} [opts.baseUrl]
   * @param {import('../../domain/ports/BudgetGuard').BudgetGuard} [opts.budget]
   * @param {import('../../domain/ports/ChatLogger').ChatLogger} [opts.logger]
   * @param {{record: Function}} [opts.usageRecorder]
   * @param {Object} [opts.client] pre-built OpenAI client; the seam tests use
   *   to exercise batching and retry without a network call
   */
  constructor({
    apiKey,
    model = 'text-embedding-3-small',
    baseUrl = '',
    budget = null,
    logger = null,
    usageRecorder = null,
    client = null,
  }) {
    if (!client && !apiKey) {
      throw new ConfigError('OPENAI_API_KEY is missing — cannot embed documents');
    }
    this.modelName = model;
    this.budget = budget;
    this.logger = logger;
    this.usageRecorder = usageRecorder;
    this.client = client || new OpenAI({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });
    this.dims = DEFAULT_DIMENSIONS;
  }

  model() {
    return this.modelName;
  }

  dimensions() {
    return this.dims;
  }

  /**
   * @param {string[]} texts
   * @param {{tag?: string}} [opts]
   * @returns {Promise<Float32Array[]>}
   */
  async embedBatch(texts, { tag = 'embed_document' } = {}) {
    if (!Array.isArray(texts) || texts.length === 0) return [];

    const out = [];
    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const slice = texts.slice(start, start + BATCH_SIZE);
      const vectors = await this.requestWithRetry(slice, tag);
      out.push(...vectors);
    }
    return out;
  }

  /** @returns {Promise<Float32Array>} */
  async embedOne(text, { tag = 'embed_query' } = {}) {
    const [vector] = await this.embedBatch([text], { tag });
    if (!vector) throw new DocumentError('Embedding returned no vector', 'EMBED_EMPTY');
    return vector;
  }

  /** One HTTP request, retried per policy. @private */
  async requestWithRetry(inputs, tag) {
    // Budget is checked per request rather than per chunk: the request is the
    // unit of spend, and the guard counts calls.
    if (this.budget && !this.budget.canCall()) {
      throw new BudgetExhaustedError('Embedding budget exhausted');
    }

    const callStarted = Date.now();
    const usageBase = {
      source: 'chatbot',
      tag,
      provider: 'openai',
      endpoint: ENDPOINT,
      model: this.modelName,
      expectJson: false,
      // The usage row's message column expects a chat-shaped array; record the
      // input count rather than the text, which can be megabytes.
      messages: [{ role: 'user', content: `[${inputs.length} embedding input(s)]` }],
    };

    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const started = Date.now();
      try {
        const response = await this.client.embeddings.create({
          model: this.modelName,
          input: inputs,
        });

        const data = response?.data || [];
        if (data.length !== inputs.length) {
          throw new DocumentError(
            `Embedding count mismatch: sent ${inputs.length}, received ${data.length}`,
            'EMBED_COUNT_MISMATCH',
          );
        }

        // The API may return items out of order; index is authoritative.
        const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        const vectors = ordered.map((item) => normalize(item.embedding || []));

        const width = vectors[0]?.length || 0;
        if (width === 0) {
          throw new DocumentError('Embedding response contained no vector', 'EMBED_EMPTY');
        }
        if (width !== this.dims) {
          // Stored alongside every chunk, so a silent width change would make
          // old and new vectors incomparable.
          this.logger?.warn('embed', 'dimension_changed', { from: this.dims, to: width });
          this.dims = width;
        }

        this.budget?.recordCall();
        this.logger?.debug('embed', 'batch_ok', {
          tag,
          inputs: inputs.length,
          latencyMs: Date.now() - started,
          attempt: attempt + 1,
        });
        this.usageRecorder?.record({
          ...usageBase,
          status: 'ok',
          usage: {
            prompt_tokens: response?.usage?.prompt_tokens ?? null,
            completion_tokens: 0,
          },
          attempts: attempt + 1,
          latencyMs: Date.now() - callStarted,
          responsePreview: `${vectors.length} vector(s) of ${width} dims`,
        });

        return vectors;
      } catch (err) {
        lastErr = err;
        const status = err?.status || err?.code || 'network';
        this.logger?.warn('embed', 'batch_failed', {
          tag,
          status,
          attempt: attempt + 1,
          message: String(err?.message || err).slice(0, 200),
        });

        const retryable =
          RETRYABLE_STATUS.has(err?.status) ||
          err?.name === 'TimeoutError' ||
          err?.cause?.code === 'ETIMEDOUT';

        if (!retryable) {
          this.usageRecorder?.record({
            ...usageBase,
            status: 'failed',
            errorCode: status,
            errorMessage: err?.message,
            attempts: attempt + 1,
            latencyMs: Date.now() - callStarted,
          });
          throw err;
        }
        if (attempt < MAX_RETRIES) await sleep(300 * Math.pow(2, attempt));
      }
    }

    this.usageRecorder?.record({
      ...usageBase,
      status: 'failed',
      errorCode: lastErr?.status || lastErr?.code || 'network',
      errorMessage: lastErr?.message,
      attempts: MAX_RETRIES + 1,
      latencyMs: Date.now() - callStarted,
    });
    throw lastErr;
  }
}

module.exports = {
  OpenAiEmbeddingGateway,
  normalize,
  BATCH_SIZE,
  DEFAULT_DIMENSIONS,
};
