/**
 * ProviderManager — STT fallback orchestrator.
 *
 * Owns an ordered chain of STT provider factories (AssemblyAI first, then
 * Speechmatics). Connects to the first available provider, streams audio to
 * it, and automatically fails over to the next provider when the active one
 * dies mid-session. A rolling ring buffer (~5s of PCM chunks) is replayed to
 * the new provider on switchover so the gap loses no speech.
 *
 * Emits:
 *   - 'partial'        { text, speaker }
 *   - 'final'          { text, speaker, start, end }
 *   - 'speakerRevision' { revision }
 *   - 'status'         { provider, state }   state: connecting|switching|active|failed
 *   - 'providerError'  { provider, message } (informational, non-fatal to the chain)
 *   - 'error'          { message }           (chain exhausted — fatal)
 *   - 'exhausted'      ()                    (all providers failed; sidecar should exit)
 */

const EventEmitter = require('events');

// 50 chunks x 100ms = 5s of audio retained for replay on switchover.
// Counted in chunks, so it tracks the host's framing: when that moved from
// 250ms to 100ms per chunk, 20 chunks quietly became 2s of replay instead of 5.
const RING_CHUNKS = 50;

// If *speech* has been flowing to the active provider for this long with zero
// partial/final activity back, treat the connection as dead even though
// neither an 'error' nor a 'closed' event ever arrived — e.g. a websocket
// dropped silently behind a NAT/firewall idle timeout.
const WATCHDOG_TIMEOUT_MS = 45_000;
const WATCHDOG_CHECK_INTERVAL_MS = 10_000;

/**
 * Normalised RMS (0..1) a chunk must reach before it counts as "somebody is
 * actually talking" for watchdog purposes.
 *
 * This gate is the whole reason the watchdog is safe. Audio never stops
 * flowing during a capture — the mixer feeds mic + loopback continuously, so
 * a silent room still produces a full-rate stream of near-zero samples. The
 * watchdog used to key off "any audio arrived recently", which is always true,
 * and so it really measured *how long nobody had spoken*. Fifty seconds of
 * quiet — one person reading a doc, a pause before a demo starts — was enough
 * to declare a perfectly healthy socket dead and force a failover, every ~50s,
 * for as long as the room stayed quiet. That reconnect loop is what piled up
 * concurrent STT sessions until the provider refused a new one.
 *
 * STT providers emit nothing during silence, so "no transcript" is only
 * evidence of a dead connection when there was speech to transcribe. ~0.02
 * (≈ -34 dBFS) sits well above mic room tone but below any normal speaking
 * voice. When in doubt this deliberately under-triggers: missing a genuinely
 * dead socket costs one late failover (the provider's own 'closed'/'error'
 * events still catch the common cases), while over-triggering costs the
 * session.
 */
const SPEECH_RMS_THRESHOLD = 0.02;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalised RMS of one PCM16LE chunk. Returns 0 for anything that isn't a
 * readable buffer, which makes the watchdog treat it as silence — the safe
 * direction (see SPEECH_RMS_THRESHOLD).
 */
function chunkRms(chunk) {
  if (!chunk || typeof chunk.readInt16LE !== 'function' || chunk.length < 2) return 0;

  const sampleCount = chunk.length >> 1;
  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = chunk.readInt16LE(i * 2) / 32768;
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / sampleCount);
}

function looksLikeAuthFailure(message) {
  return /401|403|unauthorized|unauthenticated|authentication|invalid api key|not_authorised|not_allowed/i.test(
    String(message)
  );
}

class ProviderManager extends EventEmitter {
  /**
   * @param {Array<{name: string, create: () => EventEmitter}>} chain
   *   Ordered provider factories. Each connect attempt calls create() so a
   *   fresh socket/transcriber instance is used every time.
   */
  constructor(chain) {
    super();
    this.chain = chain;
    this.chainIndex = -1;
    this.active = null;
    this.state = 'idle'; // idle | connecting | switching | active | failed | dead
    this.closing = false;
    this.failoverInFlight = false;
    this.ring = [];
    this.lastEventAt = null;
    /**
     * When speech-level audio was last handed to the active provider — not
     * when audio last arrived, which is continuously true for a whole capture
     * whether or not anyone is speaking. See SPEECH_RMS_THRESHOLD.
     */
    this.lastSpeechAt = null;
    this.watchdogTimer = null;
  }

  /** Connect to the first provider in the chain, falling through on failure. */
  async start() {
    if (this.chain.length === 0) {
      this.setState('failed', null);
      this.emit('error', { message: 'No STT providers configured' });
      this.emit('exhausted');
      return;
    }
    await this.activateChainFrom(0, { failover: false });
  }

  /**
   * Feed a PCM16 chunk (Buffer) to the active provider. Always retained in
   * the ring buffer so it can be replayed after a switchover.
   */
  sendAudio(chunk) {
    if (this.closing || this.state === 'dead') return;

    this.ring.push(chunk);
    if (this.ring.length > RING_CHUNKS) this.ring.shift();

    if (this.active) {
      if (chunkRms(chunk) >= SPEECH_RMS_THRESHOLD) this.lastSpeechAt = Date.now();
      // A provider whose socket is closing can throw synchronously from here.
      // This runs on the stdin 'data' handler, where an escaping exception is
      // an uncaught exception and kills the process mid-meeting — the audio
      // path must never be able to do that.
      try {
        this.active.sendAudio(chunk);
      } catch (err) {
        this.emit('providerError', {
          provider: this.active.name,
          message: `sendAudio failed: ${err?.message || err}`,
        });
      }
    }
  }

  /** Graceful shutdown: close the active provider, suppress further events. */
  async close() {
    this.closing = true;
    this.state = 'dead';
    this.stopWatchdog();
    const provider = this.active;
    this.active = null;
    if (provider) {
      await provider.close();
    }
  }

  // --- internals -----------------------------------------------------------

  setState(state, providerName) {
    this.state = state;
    this.emit('status', { provider: providerName, state });
  }

  /**
   * Give a provider an 'error' listener the instant it exists.
   *
   * EventEmitter turns an 'error' emission that has no registered listener
   * into a *thrown* exception. In a sidecar that is an uncaught exception:
   * the process dies, stdout closes, and the host can only report
   * "transcription process ended unexpectedly" with no reason attached.
   *
   * The real handler is attached in setActive(), which only ever runs for a
   * provider that connected successfully. A provider whose connect() failed —
   * or one that has since been detached by a failover — therefore had no
   * 'error' listener at all, while its websocket was still open and could
   * still deliver a server-side error seconds later. A Speechmatics
   * "Concurrent Quota Exceeded" rejection arriving on exactly such a provider
   * is what killed live meetings mid-session.
   *
   * This listener only reports; setActive()'s handler is the one that reacts,
   * and the `active` check keeps exactly one of them acting on any given
   * event.
   */
  guardErrors(provider) {
    provider.on('error', (payload) => {
      if (this.active === provider) return; // setActive()'s handler owns this one
      this.emit('providerError', {
        provider: provider.name,
        message: `detached provider reported: ${payload?.message || payload}`,
      });
    });
  }

  /**
   * Tear a provider down without letting teardown failures escape. Closing is
   * always best-effort — the connection we are closing is by definition one we
   * already believe is broken.
   */
  async closeQuietly(provider) {
    if (!provider) return;
    try {
      await provider.close();
    } catch (_) {
      /* best-effort teardown */
    }
  }

  /**
   * Walk the chain starting at `index`, connecting to each provider with its
   * retry policy until one succeeds. Emits 'exhausted' if none do.
   */
  async activateChainFrom(index, { failover }) {
    for (let i = index; i < this.chain.length; i++) {
      if (this.closing) return false;

      this.chainIndex = i;
      const descriptor = this.chain[i];
      this.setState(failover || i > 0 ? 'switching' : 'connecting', descriptor.name);

      const provider = await this.connectWithRetry(descriptor);
      if (provider) {
        this.setActive(provider);
        return true;
      }
      // Connect failed after retries — fall through to the next provider.
    }

    this.setState('failed', this.chain[this.chainIndex]?.name || null);
    this.emit('error', { message: 'All STT providers failed to connect' });
    this.emit('exhausted');
    return false;
  }

  /**
   * Try to connect to a provider, retrying per its policy. Auth failures are
   * not retried (a bad key won't fix itself). Returns the connected provider
   * instance or null.
   */
  async connectWithRetry(descriptor) {
    const policy = descriptor.retryPolicy || { maxRetries: 0, backoffMs: [] };
    const attempts = policy.maxRetries + 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (this.closing) return null;

      const provider = descriptor.create();
      this.guardErrors(provider);
      try {
        await provider.connect();
        return provider;
      } catch (err) {
        const message = err?.message || String(err);
        this.emit('providerError', {
          provider: descriptor.name,
          message: `connect failed: ${message}`,
        });

        // connect() failing does not mean no socket was opened — the
        // Speechmatics client opens one before start() resolves. Left alone it
        // keeps holding a server-side session against the account's
        // concurrency quota until the server times it out.
        await this.closeQuietly(provider);

        if (looksLikeAuthFailure(message)) break;

        if (attempt < attempts - 1) {
          const delay = policy.backoffMs[attempt] || 2000;
          await sleep(delay);
        }
      }
    }
    return null;
  }

  /** Wire up a connected provider as the active one and replay buffered audio. */
  setActive(provider) {
    this.active = provider;
    this.lastEventAt = Date.now();
    this.setState('active', provider.name);
    this.startWatchdog();

    provider.on('partial', (event) => {
      if (this.active !== provider) return;
      this.lastEventAt = Date.now();
      this.emit('partial', event);
    });

    provider.on('final', (event) => {
      if (this.active !== provider) return;
      this.lastEventAt = Date.now();
      // Everything up to this final has been transcribed — drop the replay
      // buffer so a later switchover doesn't duplicate it.
      this.ring = [];
      this.emit('final', event);
    });

    provider.on('speakerRevision', (event) => {
      if (this.active === provider) this.emit('speakerRevision', event);
    });

    provider.on('error', ({ message, fatal }) => {
      if (this.active !== provider) return;
      this.emit('providerError', { provider: provider.name, message });
      if (fatal) this.handleActiveFailure();
      // Non-fatal errors: wait for the subsequent 'closed' event.
    });

    provider.on('closed', () => {
      if (this.closing || this.active !== provider) return;
      this.handleActiveFailure();
    });

    // Replay audio captured since the last final so the switchover gap
    // (~1-2s of connect time) loses no speech.
    for (const chunk of this.ring) {
      provider.sendAudio(chunk);
    }
  }

  /** Poll for a live provider that has gone silent without telling us. */
  startWatchdog() {
    this.stopWatchdog();
    this.watchdogTimer = setInterval(() => {
      if (this.closing || this.state !== 'active' || !this.active) return;

      const now = Date.now();
      const silentForMs = now - (this.lastEventAt || now);
      // Speech, not merely audio: a quiet room streams continuously and must
      // never be mistaken for a dead socket. See SPEECH_RMS_THRESHOLD.
      const speechRecentlyFlowing =
        this.lastSpeechAt && now - this.lastSpeechAt < WATCHDOG_TIMEOUT_MS;

      if (silentForMs > WATCHDOG_TIMEOUT_MS && speechRecentlyFlowing) {
        const provider = this.active;
        this.emit('providerError', {
          provider: provider.name,
          message: `no transcript activity for ${Math.round(silentForMs / 1000)}s while speech is flowing — assuming the connection died silently`,
        });
        this.handleActiveFailure();
      }
    }, WATCHDOG_CHECK_INTERVAL_MS);
  }

  stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /** The active provider died: switch to the next in chain, or reconnect. */
  async handleActiveFailure() {
    if (this.closing || this.failoverInFlight) return;
    this.failoverInFlight = true;
    this.stopWatchdog();

    try {
      const previous = this.active;
      this.active = null; // detach: further events from it are ignored

      // Detaching is not closing. The old websocket stays open, keeps its
      // server-side session alive, and keeps consuming one of the account's
      // concurrent-stream slots. Every failover used to leak one, so a session
      // that failed over a few times would eventually be refused a new stream
      // ("Concurrent Quota Exceeded") — the error that then crashed the
      // sidecar. Close it before asking for another.
      await this.closeQuietly(previous);

      const nextIndex = this.chainIndex + 1;
      if (nextIndex < this.chain.length) {
        await this.activateChainFrom(nextIndex, { failover: true });
        return;
      }

      // Last provider in the chain — try to reconnect it with backoff.
      const descriptor = this.chain[this.chainIndex];
      this.setState('switching', descriptor.name);
      const provider = await this.connectWithRetry(descriptor);
      if (provider) {
        this.setActive(provider);
      } else {
        this.setState('failed', descriptor.name);
        this.emit('error', {
          message: `${descriptor.name} failed and no fallback provider is available`,
        });
        this.emit('exhausted');
      }
    } finally {
      this.failoverInFlight = false;
    }
  }
}

module.exports = { ProviderManager };
