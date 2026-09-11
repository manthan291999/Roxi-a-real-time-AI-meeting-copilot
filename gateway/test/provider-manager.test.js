/**
 * ProviderManager owns the STT fallback chain and the liveness watchdog — the
 * two pieces that decide whether a live meeting keeps transcribing. It had no
 * tests, and both pieces were wrong in ways that ended sessions mid-meeting:
 *
 *   - the watchdog keyed off "audio arrived recently", which is true for the
 *     whole of every capture (the mixer streams continuously whether or not
 *     anyone is talking), so a quiet room was read as a dead socket and forced
 *     a failover roughly every 50s;
 *   - a failover detached the old provider but never closed it, so each one
 *     leaked a live server-side session until the provider refused the next
 *     connect on its concurrency quota;
 *   - that refusal arrived as an 'error' on a provider that had no 'error'
 *     listener (listeners are only attached once a provider goes active),
 *     which EventEmitter turns into a thrown exception — an uncaught exception
 *     that killed the sidecar and the meeting with it.
 *
 * These cover all three, plus the failover behaviour that has to keep working.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');

const { ProviderManager } = require('../stt/provider-manager.js');

/** 250ms of 16kHz mono PCM16 at a constant amplitude. */
function pcmChunk(amplitude) {
  const samples = 4000;
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    // Alternating sign keeps the mean near zero so RMS reflects amplitude.
    buf.writeInt16LE(i % 2 === 0 ? amplitude : -amplitude, i * 2);
  }
  return buf;
}

const SILENCE = pcmChunk(0);
/** ~0.001 normalised — mic room tone, well under the speech gate. */
const ROOM_TONE = pcmChunk(33);
/** ~0.3 normalised — an ordinary speaking voice. */
const SPEECH = pcmChunk(9830);

class FakeProvider extends EventEmitter {
  constructor(name, { failConnect = null } = {}) {
    super();
    this.name = name;
    this.failConnect = failConnect;
    this.sent = [];
    this.closed = false;
  }

  async connect() {
    if (this.failConnect) throw new Error(this.failConnect);
  }

  sendAudio(chunk) {
    this.sent.push(chunk);
  }

  async close() {
    this.closed = true;
  }
}

/**
 * Build a chain of descriptors plus the provider instances they hand out, so a
 * test can assert on what was created, closed, and fed.
 */
function chainOf(specs) {
  const created = [];
  const chain = specs.map((spec) => ({
    name: spec.name,
    retryPolicy: { maxRetries: 0, backoffMs: [] },
    create: () => {
      const p = new FakeProvider(spec.name, spec);
      created.push(p);
      return p;
    },
  }));
  return { chain, created };
}

/**
 * Build a manager whose watchdog interval is captured rather than scheduled,
 * so a test can run a watchdog pass at an arbitrary simulated time instead of
 * waiting ~50s of real time for one.
 */
function managerWithFakeClock(chain) {
  const realSetInterval = global.setInterval;
  const realClearInterval = global.clearInterval;
  let tickFn = null;

  global.setInterval = (cb) => {
    tickFn = cb;
    return { fake: true };
  };
  global.clearInterval = (handle) => {
    if (handle && handle.fake) {
      tickFn = null;
      return;
    }
    return realClearInterval(handle);
  };

  const manager = new ProviderManager(chain);

  /** Run one watchdog pass now. */
  const tick = () => {
    if (tickFn) tickFn();
  };

  /**
   * Backdate the last transcript the manager saw, which is how a test says
   * "this many ms have gone by with nothing coming back from the provider"
   * without moving the wall clock (and so without also ageing the speech
   * timestamp, which the watchdog reads against the same window).
   */
  const noTranscriptFor = (ms) => {
    manager.lastEventAt = Date.now() - ms;
  };

  const restore = () => {
    global.setInterval = realSetInterval;
    global.clearInterval = realClearInterval;
  };

  return { manager, tick, noTranscriptFor, restore };
}

// --- the watchdog must not mistake a quiet room for a dead connection -------

test('a quiet room does not trigger a failover, however long it lasts', async () => {
  const { chain, created } = chainOf([{ name: 'primary' }, { name: 'fallback' }]);
  const { manager, tick, noTranscriptFor, restore } = managerWithFakeClock(chain);
  const statuses = [];
  manager.on('status', (s) => statuses.push(`${s.provider}:${s.state}`));

  try {
    await manager.start();
    assert.deepStrictEqual(statuses, ['primary:connecting', 'primary:active']);

    // Ten minutes of silence and room tone, exactly as a real capture streams
    // it — the mixer never stops sending, whether or not anyone is speaking.
    for (let i = 0; i < 2400; i++) manager.sendAudio(i % 2 ? SILENCE : ROOM_TONE);
    noTranscriptFor(10 * 60_000);

    tick();
    await new Promise((r) => setImmediate(r));

    assert.strictEqual(manager.active, created[0], 'still on the primary provider');
    assert.strictEqual(created.length, 1, 'no fallback provider was ever created');
    assert.deepStrictEqual(statuses, ['primary:connecting', 'primary:active']);
  } finally {
    await manager.close();
    restore();
  }
});

test('speech with no transcripts coming back does trigger a failover', async () => {
  const { chain, created } = chainOf([{ name: 'primary' }, { name: 'fallback' }]);
  const { manager, tick, noTranscriptFor, restore } = managerWithFakeClock(chain);
  const errors = [];
  manager.on('providerError', (e) => errors.push(e.message));

  try {
    await manager.start();
    manager.sendAudio(SPEECH);
    noTranscriptFor(50_000);

    tick();
    await new Promise((r) => setImmediate(r));

    assert.strictEqual(created.length, 2, 'failed over to the fallback provider');
    assert.strictEqual(manager.active, created[1]);
    assert.match(errors.join(' '), /no transcript activity/);
  } finally {
    await manager.close();
    restore();
  }
});

test('a transcript arriving keeps the connection alive past the timeout', async () => {
  const { chain, created } = chainOf([{ name: 'primary' }, { name: 'fallback' }]);
  const { manager, tick, noTranscriptFor, restore } = managerWithFakeClock(chain);

  try {
    await manager.start();
    manager.sendAudio(SPEECH);
    created[0].emit('final', { text: 'hello', speaker: 'Speaker A' });
    // Speech still flowing, but the last transcript is inside the window.
    noTranscriptFor(40_000);

    tick();
    await new Promise((r) => setImmediate(r));

    assert.strictEqual(manager.active, created[0]);
    assert.strictEqual(created.length, 1);
  } finally {
    await manager.close();
    restore();
  }
});

// --- a failover must not leak the connection it replaced -------------------

test('failover closes the provider it is replacing', async () => {
  const { chain, created } = chainOf([{ name: 'primary' }, { name: 'fallback' }]);
  const manager = new ProviderManager(chain);

  await manager.start();
  created[0].emit('closed', {});
  await new Promise((r) => setImmediate(r));

  assert.strictEqual(created[0].closed, true, 'the replaced provider was closed, not just detached');
  assert.strictEqual(manager.active, created[1]);

  await manager.close();
});

test('a provider that fails to connect is closed rather than left holding a socket', async () => {
  const { chain, created } = chainOf([
    { name: 'primary', failConnect: 'connect refused' },
    { name: 'fallback' },
  ]);
  const manager = new ProviderManager(chain);

  await manager.start();

  assert.strictEqual(created[0].closed, true);
  assert.strictEqual(manager.active, created[1]);

  await manager.close();
});

// --- an error from a provider nobody is listening to must not be fatal -----

test('an error from a provider that failed to connect does not throw', async () => {
  const { chain, created } = chainOf([
    { name: 'primary', failConnect: 'connect refused' },
    { name: 'fallback' },
  ]);
  const manager = new ProviderManager(chain);
  const reported = [];
  manager.on('providerError', (e) => reported.push(e.message));

  await manager.start();

  // Exactly the real crash: the discarded provider's socket is still open and
  // the server rejects it after the fact. Unguarded, EventEmitter turns this
  // emit into a throw that takes the whole process down.
  assert.doesNotThrow(() => {
    created[0].emit('error', { message: 'Concurrent Quota Exceeded', fatal: false });
  });
  assert.match(reported.join(' '), /Concurrent Quota Exceeded/);

  await manager.close();
});

test('an error from a detached provider does not throw or disturb the active one', async () => {
  const { chain, created } = chainOf([{ name: 'primary' }, { name: 'fallback' }]);
  const manager = new ProviderManager(chain);

  await manager.start();
  created[0].emit('closed', {});
  await new Promise((r) => setImmediate(r));

  const activeBefore = manager.active;
  assert.doesNotThrow(() => {
    created[0].emit('error', { message: 'late error from the old socket', fatal: true });
  });
  assert.strictEqual(manager.active, activeBefore, 'the live provider was untouched');

  await manager.close();
});

// --- the audio hot path must never be able to kill the process -------------

test('a provider throwing from sendAudio is reported, not propagated', async () => {
  const { chain, created } = chainOf([{ name: 'primary' }]);
  const manager = new ProviderManager(chain);
  const reported = [];
  manager.on('providerError', (e) => reported.push(e.message));

  await manager.start();
  created[0].sendAudio = () => {
    throw new Error('WebSocket is not open');
  };

  assert.doesNotThrow(() => manager.sendAudio(SPEECH));
  assert.match(reported.join(' '), /sendAudio failed.*WebSocket is not open/);

  await manager.close();
});
