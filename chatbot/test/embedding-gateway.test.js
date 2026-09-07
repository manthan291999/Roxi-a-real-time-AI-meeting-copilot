/**
 * Unit tests: the embedding adapter — normalization, batching, ordering,
 * retry, and budget gating. The OpenAI client is faked through the
 * constructor's `client` seam, so nothing here touches the network.
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  OpenAiEmbeddingGateway,
  normalize,
  BATCH_SIZE,
} = require('../src/infrastructure/embedding/OpenAiEmbeddingGateway');
const { CallCountBudgetGuard } = require('../src/infrastructure/budget/CallCountBudgetGuard');
const { BudgetExhaustedError, ConfigError } = require('../src/domain/errors');

/** Records every request; returns deterministic, deliberately UN-normalized vectors. */
function fakeClient({ width = 4, failures = [], outOfOrder = false, dropOne = false } = {}) {
  const calls = [];
  let n = 0;
  return {
    calls,
    embeddings: {
      create: async ({ input }) => {
        calls.push(input);
        const failure = failures[n++];
        if (failure) throw failure;

        let data = input.map((_, i) => ({
          index: i,
          // Magnitude 5 (3-4-5 triangle) so normalization is observable.
          embedding: Array.from({ length: width }, (_, d) => (d === 0 ? 3 : d === 1 ? 4 : 0)),
        }));
        // Tag each vector so ordering can be asserted.
        data = data.map((d, i) => ({ ...d, embedding: d.embedding.map((v, j) => (j === 2 ? i : v)) }));
        if (outOfOrder) data.reverse();
        if (dropOne) data.pop();
        return { data, usage: { prompt_tokens: input.length * 10 } };
      },
    },
  };
}

const gateway = (client, extra = {}) =>
  new OpenAiEmbeddingGateway({ client, model: 'text-embedding-3-small', ...extra });

test('construction', async (t) => {
  await t.test('requires a key when no client is injected', () => {
    assert.throws(() => new OpenAiEmbeddingGateway({ apiKey: '' }), ConfigError);
  });

  await t.test('reports its model and dimensions', () => {
    const g = gateway(fakeClient());
    assert.strictEqual(g.model(), 'text-embedding-3-small');
    assert.strictEqual(g.dimensions(), 1536);
  });
});

test('normalize', async (t) => {
  await t.test('scales to unit length', () => {
    const v = normalize([3, 4]);
    assert.ok(Math.abs(Math.hypot(v[0], v[1]) - 1) < 1e-6);
    assert.ok(Math.abs(v[0] - 0.6) < 1e-6);
    assert.ok(Math.abs(v[1] - 0.8) < 1e-6);
  });

  await t.test('a zero vector stays zero rather than becoming NaN', () => {
    const v = normalize([0, 0, 0]);
    assert.deepStrictEqual([...v], [0, 0, 0]);
  });
});

test('embedBatch', async (t) => {
  await t.test('empty input makes no request', async () => {
    const client = fakeClient();
    assert.deepStrictEqual(await gateway(client).embedBatch([]), []);
    assert.deepStrictEqual(await gateway(client).embedBatch(null), []);
    assert.strictEqual(client.calls.length, 0);
  });

  await t.test('returns one unit vector per input', async () => {
    const vectors = await gateway(fakeClient()).embedBatch(['a', 'b', 'c']);
    assert.strictEqual(vectors.length, 3);
    for (const v of vectors) {
      assert.ok(v instanceof Float32Array);
      let sum = 0;
      for (const x of v) sum += x * x;
      assert.ok(Math.abs(Math.sqrt(sum) - 1) < 1e-6, 'not unit length');
    }
  });

  await t.test('splits into requests of BATCH_SIZE', async () => {
    const client = fakeClient();
    const texts = Array.from({ length: BATCH_SIZE * 2 + 5 }, (_, i) => `t${i}`);
    const vectors = await gateway(client).embedBatch(texts);

    assert.strictEqual(vectors.length, texts.length, 'one vector per input');
    assert.strictEqual(client.calls.length, 3, 'three HTTP requests');
    assert.deepStrictEqual(client.calls.map((c) => c.length), [BATCH_SIZE, BATCH_SIZE, 5]);
  });

  await t.test('reorders by index when the API returns out of order', async () => {
    const inOrder = await gateway(fakeClient()).embedBatch(['a', 'b', 'c']);
    const shuffled = await gateway(fakeClient({ outOfOrder: true })).embedBatch(['a', 'b', 'c']);
    // Component 2 carries the original position, so it must still ascend.
    assert.deepStrictEqual(
      shuffled.map((v) => Math.round(v[2] * 1e6)),
      inOrder.map((v) => Math.round(v[2] * 1e6)),
    );
  });

  await t.test('a short response is an error, not a silent misalignment', async () => {
    await assert.rejects(
      () => gateway(fakeClient({ dropOne: true })).embedBatch(['a', 'b']),
      { code: 'EMBED_COUNT_MISMATCH' },
    );
  });
});

test('embedOne returns a single vector', async () => {
  const v = await gateway(fakeClient()).embedOne('what did we decide?');
  assert.ok(v instanceof Float32Array);
  assert.strictEqual(v.length, 4);
});

test('retry policy', async (t) => {
  const rateLimited = Object.assign(new Error('rate limited'), { status: 429 });
  const badRequest = Object.assign(new Error('bad request'), { status: 400 });

  await t.test('retries a 429 and then succeeds', async () => {
    const client = fakeClient({ failures: [rateLimited] });
    const vectors = await gateway(client).embedBatch(['a']);
    assert.strictEqual(vectors.length, 1);
    assert.strictEqual(client.calls.length, 2, 'one failed attempt then one success');
  });

  await t.test('gives up after the retry budget', async () => {
    const client = fakeClient({ failures: [rateLimited, rateLimited, rateLimited] });
    await assert.rejects(() => gateway(client).embedBatch(['a']), /rate limited/);
    assert.strictEqual(client.calls.length, 3, 'initial attempt plus two retries');
  });

  await t.test('does not retry a non-retryable status', async () => {
    const client = fakeClient({ failures: [badRequest] });
    await assert.rejects(() => gateway(client).embedBatch(['a']), /bad request/);
    assert.strictEqual(client.calls.length, 1);
  });
});

test('budget', async (t) => {
  await t.test('refuses once the hard limit is reached', async () => {
    const budget = new CallCountBudgetGuard({ softLimit: 1, hardLimit: 1 });
    const client = fakeClient();
    const g = gateway(client, { budget });

    await g.embedBatch(['first']);
    assert.strictEqual(budget.remaining(), 0);

    await assert.rejects(() => g.embedBatch(['second']), BudgetExhaustedError);
    assert.strictEqual(client.calls.length, 1, 'the refused call never reached the API');
  });

  await t.test('counts one call per request, not per input', async () => {
    const budget = new CallCountBudgetGuard({ softLimit: 99, hardLimit: 99 });
    const texts = Array.from({ length: BATCH_SIZE + 1 }, (_, i) => `t${i}`);
    await gateway(fakeClient(), { budget }).embedBatch(texts);
    assert.strictEqual(budget.remaining(), 97, 'two requests consumed two of the budget');
  });
});

test('usage recording', async (t) => {
  await t.test('records a successful batch with token counts', async () => {
    const rows = [];
    await gateway(fakeClient(), { usageRecorder: { record: (r) => rows.push(r) } })
      .embedBatch(['a', 'b'], { tag: 'embed_document' });

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].status, 'ok');
    assert.strictEqual(rows[0].tag, 'embed_document');
    assert.strictEqual(rows[0].model, 'text-embedding-3-small');
    assert.strictEqual(rows[0].usage.prompt_tokens, 20);
    assert.strictEqual(rows[0].usage.completion_tokens, 0, 'embeddings have no output tokens');
    // The chunk text can be megabytes; it must not be copied into the usage row.
    assert.match(rows[0].messages[0].content, /2 embedding input\(s\)/);
  });

  await t.test('records a failure', async () => {
    const rows = [];
    const client = fakeClient({ failures: [Object.assign(new Error('nope'), { status: 400 })] });
    await assert.rejects(() =>
      gateway(client, { usageRecorder: { record: (r) => rows.push(r) } }).embedBatch(['a']));
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].status, 'failed');
    assert.strictEqual(rows[0].errorCode, 400);
  });

  await t.test('default tags distinguish document from query spend', async () => {
    const rows = [];
    const recorder = { record: (r) => rows.push(r) };
    await gateway(fakeClient(), { usageRecorder: recorder }).embedBatch(['a']);
    await gateway(fakeClient(), { usageRecorder: recorder }).embedOne('q');
    assert.deepStrictEqual(rows.map((r) => r.tag), ['embed_document', 'embed_query']);
  });
});
