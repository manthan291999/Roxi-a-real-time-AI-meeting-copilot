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

// 20 chunks x 250ms = 5s of audio retained for replay on switchover.
const RING_CHUNKS = 20;



function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    if (this.active) this.active.sendAudio(chunk);
  }

  /** Graceful shutdown: close the active provider, suppress further events. */
  async close() {
    this.closing = true;
    this.state = 'dead';
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
      try {
        await provider.connect();
        return provider;
      } catch (err) {
        const message = err?.message || String(err);
        this.emit('providerError', {
          provider: descriptor.name,
          message: `connect failed: ${message}`,
        });

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
    this.setState('active', provider.name);

    provider.on('partial', (event) => {
      if (this.active === provider) this.emit('partial', event);
    });

    provider.on('final', (event) => {
      if (this.active !== provider) return;
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

  /** The active provider died: switch to the next in chain, or reconnect. */
  async handleActiveFailure() {
    if (this.closing || this.failoverInFlight) return;
    this.failoverInFlight = true;

    try {
      this.active = null; // detach: further events from it are ignored

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
