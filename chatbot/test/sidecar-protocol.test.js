/**
 * Integration tests: the stdio protocol — document handlers and the two busy
 * lanes. The sidecar is driven through a fake stdin stream and its stdout is
 * captured, so this exercises the real readline/dispatch path.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { PassThrough } = require('node:stream');

const { startStdioSidecar } = require('../src/transport/stdioSidecar');
const { JsonLineLogger } = require('../src/infrastructure/logging/JsonLineLogger');
const { DocumentError } = require('../src/domain/errors');

const silentLogger = new JsonLineLogger({ level: 'error', sink: () => {} });

/** Deferred promise, so a test can hold a request open and observe overlap. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * Run the sidecar against injected streams — no real stdio, no process.exit.
 */
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
    /** Let the readline 'line' event and any awaited work drain. */
    settle: () => new Promise((r) => setImmediate(() => setImmediate(r))),
    of: (type) => lines.filter((l) => l.type === type),
  };
}

test('ListDocuments returns the library', async () => {
  const h = harness({
    manageDocuments: { list: () => [{ docId: 'd1', fileName: 'spec.pdf', chunkCount: 4 }] },
  });
  h.send({ type: 'ListDocuments' });
  await h.settle();

  const [list] = h.of('DocumentList');
  assert.deepStrictEqual(list.docs, [{ docId: 'd1', fileName: 'spec.pdf', chunkCount: 4 }]);
});

test('DeleteDocument acknowledges with the id', async () => {
  const removed = [];
  const h = harness({
    manageDocuments: { list: () => [], remove: (id) => { removed.push(id); return { docId: id }; } },
  });
  h.send({ type: 'DeleteDocument', docId: 'd7' });
  await h.settle();

  assert.deepStrictEqual(removed, ['d7']);
  assert.deepStrictEqual(h.of('DocumentDeleted')[0], { type: 'DocumentDeleted', docId: 'd7' });
});

test('a delete failure comes back as an Error correlated by docId', async () => {
  const h = harness({
    manageDocuments: {
      list: () => [],
      remove: () => { throw new DocumentError('No document with id "gone"', 'DOCUMENT_NOT_FOUND'); },
    },
  });
  h.send({ type: 'DeleteDocument', docId: 'gone' });
  await h.settle();

  const [err] = h.of('Error');
  assert.strictEqual(err.code, 'DOCUMENT_NOT_FOUND');
  assert.strictEqual(err.docId, 'gone');
  // Document errors belong to a file, not a conversation.
  assert.strictEqual(err.threadId, undefined);
});

test('UploadDocument streams progress then DocumentReady', async () => {
  const h = harness({
    indexDocument: {
      execute: async ({ docId, onProgress }) => {
        onProgress({ phase: 'parse' });
        onProgress({ phase: 'embed', done: 0, total: 2 });
        onProgress({ phase: 'embed', done: 2, total: 2 });
        return { docId, fileName: 'spec.pdf', chunkCount: 2, pageCount: 5, deduped: false };
      },
    },
  });
  h.send({ type: 'UploadDocument', docId: 'd1', filePath: '/tmp/spec.pdf', fileName: 'spec.pdf' });
  await h.settle();

  const progress = h.of('DocumentProgress');
  assert.deepStrictEqual(progress.map((p) => p.phase), ['parse', 'embed', 'embed']);
  assert.ok(progress.every((p) => p.docId === 'd1'));
  // Phases with no count must not emit null totals the UI would divide by.
  assert.strictEqual('done' in progress[0], false);
  assert.strictEqual(progress[2].done, 2);

  const [ready] = h.of('DocumentReady');
  assert.strictEqual(ready.docId, 'd1');
  assert.strictEqual(ready.chunkCount, 2);
  assert.strictEqual(ready.pageCount, 5);
  assert.strictEqual(ready.deduped, false);
});

test('a failed upload emits exactly one Error, not two', async () => {
  const h = harness({
    indexDocument: {
      execute: async () => { throw new DocumentError('No readable text', 'DOCUMENT_NO_TEXT'); },
    },
  });
  h.send({ type: 'UploadDocument', docId: 'd1', filePath: '/tmp/scan.pdf' });
  await h.settle();

  const errors = h.of('Error');
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(errors[0].code, 'DOCUMENT_NO_TEXT');
  assert.strictEqual(errors[0].docId, 'd1');
  assert.strictEqual(h.of('DocumentReady').length, 0);
});

test('a second upload while one is indexing is rejected as BUSY', async () => {
  const gate = deferred();
  const h = harness({
    indexDocument: {
      execute: async ({ docId }) => {
        await gate.promise;
        return { docId, fileName: 'a.pdf', chunkCount: 1, pageCount: null, deduped: false };
      },
    },
  });
  h.send({ type: 'UploadDocument', docId: 'd1', filePath: '/tmp/a.pdf' });
  await h.settle();
  h.send({ type: 'UploadDocument', docId: 'd2', filePath: '/tmp/b.pdf' });
  await h.settle();

  const busy = h.of('Error').find((e) => e.code === 'BUSY');
  assert.ok(busy, 'expected the second upload to be rejected');
  assert.strictEqual(busy.docId, 'd2');

  gate.resolve();
  await h.settle();
  assert.strictEqual(h.of('DocumentReady').length, 1);
});

test('a question asked DURING an upload is answered, not rejected', async () => {
  // The whole reason the lanes are split: this is exactly when someone wants
  // to ask about the document they just added.
  const gate = deferred();
  const h = harness({
    indexDocument: {
      execute: async ({ docId }) => {
        await gate.promise;
        return { docId, fileName: 'a.pdf', chunkCount: 1, pageCount: null, deduped: false };
      },
    },
    useCase: {
      run: async ({ question }) => ({ answer: `answered: ${question}`, sources: [], route: 'generate' }),
    },
  });

  h.send({ type: 'UploadDocument', docId: 'd1', filePath: '/tmp/a.pdf' });
  await h.settle();
  h.send({ type: 'Ask', question: 'what is in it?', threadId: 'ask' });
  await h.settle();

  const [reply] = h.of('ChatReply');
  assert.ok(reply, 'the question must be answered while the upload is in flight');
  assert.strictEqual(reply.threadId, 'ask');
  assert.strictEqual(reply.payload.answer, 'answered: what is in it?');
  assert.strictEqual(h.of('Error').length, 0);

  gate.resolve();
  await h.settle();
});

test('an upload started DURING a question is accepted, not rejected', async () => {
  const gate = deferred();
  const h = harness({
    useCase: {
      run: async () => { await gate.promise; return { answer: 'done', sources: [], route: 'generate' }; },
    },
    indexDocument: {
      execute: async ({ docId }) => ({ docId, fileName: 'a.pdf', chunkCount: 1, pageCount: null, deduped: false }),
    },
  });

  h.send({ type: 'Ask', question: 'slow one', threadId: 'ask' });
  await h.settle();
  h.send({ type: 'UploadDocument', docId: 'd1', filePath: '/tmp/a.pdf' });
  await h.settle();

  assert.strictEqual(h.of('DocumentReady').length, 1);
  assert.strictEqual(h.of('Error').length, 0);

  gate.resolve();
  await h.settle();
});

test('a list request is served while an upload is indexing', async () => {
  const gate = deferred();
  const h = harness({
    indexDocument: {
      execute: async ({ docId }) => {
        await gate.promise;
        return { docId, fileName: 'a.pdf', chunkCount: 1, pageCount: null, deduped: false };
      },
    },
    manageDocuments: { list: () => [{ docId: 'd0', fileName: 'old.pdf' }] },
  });

  h.send({ type: 'UploadDocument', docId: 'd1', filePath: '/tmp/a.pdf' });
  await h.settle();
  h.send({ type: 'ListDocuments' });
  await h.settle();

  assert.strictEqual(h.of('DocumentList').length, 1);
  gate.resolve();
  await h.settle();
});

test('document handlers degrade cleanly with no API key (skipLlm container)', async () => {
  const h = harness({ indexDocument: null, manageDocuments: null });
  h.send({ type: 'UploadDocument', docId: 'd1', filePath: '/tmp/a.pdf' });
  await h.settle();
  h.send({ type: 'ListDocuments' });
  await h.settle();

  const [err] = h.of('Error');
  assert.strictEqual(err.code, 'CONFIG_ERROR');
  assert.strictEqual(err.docId, 'd1');
  // Listing an unavailable library is empty, not an error.
  assert.deepStrictEqual(h.of('DocumentList')[0].docs, []);
});

test('an unknown message type is still a protocol error', async () => {
  const h = harness({});
  h.send({ type: 'Nonsense' });
  await h.settle();
  assert.strictEqual(h.of('Error')[0].code, 'PROTOCOL_ERROR');
});

/** Wait long enough for N real-timer ticks of a `ms`-interval to have fired. */
function afterTicks(ms, n = 1) {
  return new Promise((r) => setTimeout(r, ms * n + ms / 2));
}

function fakeSyncEpisodicMemory(result = { embedded: 0, highWaterMark: 0 }) {
  const calls = [];
  return {
    calls,
    execute: async (opts) => {
      calls.push(opts);
      return typeof result === 'function' ? result(calls.length) : result;
    },
  };
}

test('episodic memory sync', async (t) => {
  await t.test('runs once at startup without blocking Ready', async () => {
    const syncEpisodicMemory = fakeSyncEpisodicMemory({ embedded: 3, highWaterMark: 5 });
    const h = harness({
      config: { indexMaxAgeMs: 60000, episodicSyncMaxAgeMs: 10_000 },
      syncEpisodicMemory,
    });

    // Ready is emitted synchronously; the sync call is async (fire-and-forget).
    assert.strictEqual(h.of('Ready').length, 1);
    await h.settle();
    assert.strictEqual(syncEpisodicMemory.calls.length, 1);
    assert.deepStrictEqual(syncEpisodicMemory.calls[0], undefined);
  });

  await t.test('re-runs on the configured interval for as long as the sidecar lives', async () => {
    const syncEpisodicMemory = fakeSyncEpisodicMemory();
    harness({
      config: { indexMaxAgeMs: 60000, episodicSyncMaxAgeMs: 15 },
      syncEpisodicMemory,
    });

    await afterTicks(15, 3);
    // Startup call + at least 2 interval ticks.
    assert.ok(syncEpisodicMemory.calls.length >= 3, `expected >=3 calls, got ${syncEpisodicMemory.calls.length}`);
  });

  await t.test('a background sync failure is logged, not surfaced as a protocol Error', async () => {
    const syncEpisodicMemory = { execute: async () => { throw new Error('embed budget exhausted'); } };
    const h = harness({
      config: { indexMaxAgeMs: 60000, episodicSyncMaxAgeMs: 10_000 },
      syncEpisodicMemory,
    });

    await h.settle();
    assert.strictEqual(h.of('Error').length, 0);
  });

  await t.test('shutdown stops the interval — no further calls after Shutdown', async () => {
    const syncEpisodicMemory = fakeSyncEpisodicMemory();
    const h = harness({
      config: { indexMaxAgeMs: 60000, episodicSyncMaxAgeMs: 15 },
      syncEpisodicMemory,
    });

    await afterTicks(15, 1);
    h.send({ type: 'Shutdown' });
    await h.settle();
    const countAtShutdown = syncEpisodicMemory.calls.length;

    await afterTicks(15, 3);
    assert.strictEqual(syncEpisodicMemory.calls.length, countAtShutdown, 'no calls should land after shutdown');
  });

  await t.test('SyncVectors runs a sync on demand and reports its stats', async () => {
    const syncEpisodicMemory = fakeSyncEpisodicMemory({ embedded: 12, highWaterMark: 247 });
    const h = harness({
      config: { indexMaxAgeMs: 60000, episodicSyncMaxAgeMs: 10_000 },
      syncEpisodicMemory,
    });

    // Let the startup call (fired automatically by harness construction)
    // finish and release the busy guard before sending an explicit request,
    // so this test exercises SyncVectors itself rather than racing it.
    await h.settle();
    syncEpisodicMemory.calls.length = 0;

    h.send({ type: 'SyncVectors', force: true });
    await h.settle();

    const [synced] = h.of('VectorsSynced');
    assert.deepStrictEqual(synced.stats, { episodic: { embedded: 12, highWaterMark: 247 } });
    // The explicit request's force flag reaches execute(), unlike the
    // fire-and-forget startup/interval calls which never pass force.
    const explicitCall = syncEpisodicMemory.calls.find((c) => c && c.force === true);
    assert.ok(explicitCall, 'expected one execute() call with force: true');
  });

  await t.test('a SyncVectors sent while a background sync is still in flight is rejected as BUSY, not run concurrently', async () => {
    const gate = deferred();
    let concurrentCalls = 0;
    let maxConcurrent = 0;
    const syncEpisodicMemory = {
      execute: async () => {
        concurrentCalls += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
        await gate.promise;
        concurrentCalls -= 1;
        return { embedded: 135, highWaterMark: 135 };
      },
    };
    const h = harness({
      config: { indexMaxAgeMs: 60000, episodicSyncMaxAgeMs: 10_000 },
      syncEpisodicMemory,
    });

    // The startup call is already in flight (holding the gate).
    h.send({ type: 'SyncVectors', force: true });
    await h.settle();

    const [err] = h.of('Error');
    assert.strictEqual(err.code, 'BUSY');
    assert.strictEqual(h.of('VectorsSynced').length, 0);
    assert.strictEqual(maxConcurrent, 1, 'execute() must never run twice at once');

    gate.resolve();
    await h.settle();
  });

  await t.test('SyncVectors with no episodic sync configured degrades cleanly', async () => {
    const h = harness({
      config: { indexMaxAgeMs: 60000 },
      syncEpisodicMemory: null,
    });

    h.send({ type: 'SyncVectors' });
    await h.settle();

    assert.strictEqual(h.of('Error')[0].code, 'CONFIG_ERROR');
  });
});
