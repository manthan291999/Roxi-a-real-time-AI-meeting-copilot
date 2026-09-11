/**
 * Integration tests: stdioSidecar's semantic-memory sync and episodic-purge
 * background jobs — both independent of the episodic sync timer (plan
 * §06/§05a). Same harness convention as sidecar-protocol.test.js.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { PassThrough } = require('node:stream');

const { startStdioSidecar } = require('../src/transport/stdioSidecar');
const { JsonLineLogger } = require('../src/infrastructure/logging/JsonLineLogger');

const silentLogger = new JsonLineLogger({ level: 'error', sink: () => {} });

function harness(container) {
  const stdin = new PassThrough();
  const lines = [];
  const exits = [];

  const output = {
    write: (chunk) => {
      String(chunk).split('\n').filter(Boolean).forEach((l) => lines.push(JSON.parse(l)));
      return true;
    },
  };

  const full = {
    logger: silentLogger,
    config: { indexMaxAgeMs: 60000 },
    indexBuilder: { rebuildIfStale: () => ({ rebuilt: false }), rebuild: () => ({ rows: 0 }) },
    store: {},
    shutdown: () => {},
    ...container,
  };

  startStdioSidecar(full, { input: stdin, output, exit: (code) => exits.push(code) });

  return {
    lines,
    exits,
    send: (msg) => stdin.write(JSON.stringify(msg) + '\n'),
    settle: () => new Promise((r) => setImmediate(() => setImmediate(r))),
    of: (type) => lines.filter((l) => l.type === type),
  };
}

function fakeUseCase(result = { embedded: 0 }) {
  const calls = [];
  return {
    calls,
    execute: async (opts) => {
      calls.push(opts);
      return typeof result === 'function' ? result(calls.length) : result;
    },
  };
}

function afterTicks(ms, n = 1) {
  return new Promise((r) => setTimeout(r, ms * n + ms / 2));
}

test('semantic memory sync runs on its own cadence, independent of episodic', async (t) => {
  await t.test('runs once at startup even with no episodic sync configured', async () => {
    const syncSemanticMemory = fakeUseCase({ embedded: 4 });
    const h = harness({
      config: { indexMaxAgeMs: 60000, semanticSyncMaxAgeMs: 10_000 },
      syncEpisodicMemory: null,
      syncSemanticMemory,
    });

    await h.settle();
    assert.strictEqual(syncSemanticMemory.calls.length, 1);
    // Semantic sync takes no args — it's always a full rebuild (plan §08).
    assert.deepStrictEqual(syncSemanticMemory.calls[0], undefined);
  });

  await t.test('re-runs on its own interval, decoupled from the episodic one', async () => {
    const syncEpisodicMemory = fakeUseCase();
    const syncSemanticMemory = fakeUseCase();
    harness({
      // Episodic ticks much slower than semantic here — proves the two timers
      // are independent rather than one piggybacking on the other.
      config: { indexMaxAgeMs: 60000, episodicSyncMaxAgeMs: 100_000, semanticSyncMaxAgeMs: 15 },
      syncEpisodicMemory,
      syncSemanticMemory,
    });

    await afterTicks(15, 3);
    assert.strictEqual(syncEpisodicMemory.calls.length, 1, 'episodic should only have run once (startup)');
    assert.ok(syncSemanticMemory.calls.length >= 3, `expected semantic to have ticked independently, got ${syncSemanticMemory.calls.length}`);
  });

  await t.test('a semantic sync failure is logged, not surfaced as a protocol Error', async () => {
    const syncSemanticMemory = { execute: async () => { throw new Error('embed budget exhausted'); } };
    const h = harness({
      config: { indexMaxAgeMs: 60000, semanticSyncMaxAgeMs: 10_000 },
      syncSemanticMemory,
    });

    await h.settle();
    assert.strictEqual(h.of('Error').length, 0);
  });

  await t.test('SyncVectors runs episodic and semantic together and reports both stats', async () => {
    const syncEpisodicMemory = fakeUseCase({ embedded: 12, highWaterMark: 247 });
    const syncSemanticMemory = fakeUseCase({ embedded: 3 });
    const h = harness({
      config: { indexMaxAgeMs: 60000, episodicSyncMaxAgeMs: 100_000, semanticSyncMaxAgeMs: 100_000 },
      syncEpisodicMemory,
      syncSemanticMemory,
    });

    await h.settle();
    syncEpisodicMemory.calls.length = 0;
    syncSemanticMemory.calls.length = 0;

    h.send({ type: 'SyncVectors', force: true });
    await h.settle();

    const [synced] = h.of('VectorsSynced');
    assert.deepStrictEqual(synced.stats, {
      episodic: { embedded: 12, highWaterMark: 247 },
      semantic: { embedded: 3 },
    });
  });

  await t.test('a background semantic sync in flight rejects an explicit SyncVectors as BUSY', async () => {
    const gate = new Promise(() => {}); // never resolves within the test
    const syncSemanticMemory = { execute: () => gate };
    const h = harness({
      config: { indexMaxAgeMs: 60000, semanticSyncMaxAgeMs: 100_000 },
      syncSemanticMemory,
    });

    h.send({ type: 'SyncVectors', force: true });
    await h.settle();

    const [err] = h.of('Error');
    assert.strictEqual(err.code, 'BUSY');
  });
});

test('SyncVectors threadId echo — background pushes cannot hijack a chat thread', async (t) => {
  await t.test('a tagged SyncVectors gets the same threadId back on success', async () => {
    const syncEpisodicMemory = fakeUseCase({ embedded: 1, highWaterMark: 9 });
    const h = harness({
      config: { indexMaxAgeMs: 60000, episodicSyncMaxAgeMs: 100_000 },
      syncEpisodicMemory,
    });
    await h.settle();

    h.send({ type: 'SyncVectors', force: false, threadId: '__background_sync__' });
    await h.settle();

    const [synced] = h.of('VectorsSynced');
    assert.strictEqual(synced.threadId, '__background_sync__');
  });

  await t.test('a tagged SyncVectors gets the same threadId back on a BUSY error, not untagged', async () => {
    const gate = new Promise(() => {});
    const syncEpisodicMemory = { execute: () => gate };
    const h = harness({
      config: { indexMaxAgeMs: 60000, episodicSyncMaxAgeMs: 100_000 },
      syncEpisodicMemory,
    });

    // Startup call is already in flight holding episodicSyncBusy.
    h.send({ type: 'SyncVectors', threadId: '__background_sync__' });
    await h.settle();

    const [err] = h.of('Error');
    assert.strictEqual(err.code, 'BUSY');
    assert.strictEqual(err.threadId, '__background_sync__');
  });

  await t.test('an untagged SyncVectors (manual/CLI use) still gets an untagged reply', async () => {
    const syncEpisodicMemory = fakeUseCase({ embedded: 1, highWaterMark: 9 });
    const h = harness({
      config: { indexMaxAgeMs: 60000, episodicSyncMaxAgeMs: 100_000 },
      syncEpisodicMemory,
    });
    await h.settle();

    h.send({ type: 'SyncVectors' });
    await h.settle();

    const [synced] = h.of('VectorsSynced');
    assert.strictEqual('threadId' in synced, false);
  });
});

test('episodic memory purge', async (t) => {
  await t.test('runs once at startup, independent of the sync timers', async () => {
    const purgeEpisodicMemory = fakeUseCase({ deleted: 2 });
    const h = harness({
      config: { indexMaxAgeMs: 60000, episodicPurgeIntervalMs: 100_000 },
      purgeEpisodicMemory,
    });

    await h.settle();
    assert.strictEqual(purgeEpisodicMemory.calls.length, 1);
    assert.strictEqual(h.of('Error').length, 0);
  });

  await t.test('re-runs on its own configured interval', async () => {
    const purgeEpisodicMemory = fakeUseCase({ deleted: 0 });
    harness({
      config: { indexMaxAgeMs: 60000, episodicPurgeIntervalMs: 15 },
      purgeEpisodicMemory,
    });

    await afterTicks(15, 3);
    assert.ok(purgeEpisodicMemory.calls.length >= 3, `expected >=3 calls, got ${purgeEpisodicMemory.calls.length}`);
  });

  await t.test('a purge failure is logged, not surfaced as a protocol Error', async () => {
    const purgeEpisodicMemory = { execute: async () => { throw new Error('qdrant unreachable'); } };
    const h = harness({
      config: { indexMaxAgeMs: 60000, episodicPurgeIntervalMs: 10_000 },
      purgeEpisodicMemory,
    });

    await h.settle();
    assert.strictEqual(h.of('Error').length, 0);
  });

  await t.test('shutdown stops the purge interval — no further calls after Shutdown', async () => {
    const purgeEpisodicMemory = fakeUseCase({ deleted: 0 });
    const h = harness({
      config: { indexMaxAgeMs: 60000, episodicPurgeIntervalMs: 15 },
      purgeEpisodicMemory,
    });

    await afterTicks(15, 1);
    h.send({ type: 'Shutdown' });
    await h.settle();
    const countAtShutdown = purgeEpisodicMemory.calls.length;

    await afterTicks(15, 3);
    assert.strictEqual(purgeEpisodicMemory.calls.length, countAtShutdown);
  });
});
