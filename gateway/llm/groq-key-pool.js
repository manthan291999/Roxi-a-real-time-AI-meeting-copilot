/**
 * AI Meeting Interpreter — Groq Key Pool
 *
 * Manages a pool of up to 3 Groq API keys with per-key circuit breakers.
 * When the active key hits a 429 rate limit, the pool automatically rotates
 * to the next healthy key. Keys cycle through CLOSED → OPEN → HALF-OPEN states.
 *
 * States per key:
 *   CLOSED    — healthy, requests flow through normally
 *   OPEN      — tripped after 3 consecutive 429s; blocked for cooldownMs
 *   HALF-OPEN — cooldown expired; next request is a probe:
 *               success → CLOSED, failure → OPEN (restart cooldown)
 */

const { log, metrics } = require('../infrastructure/logger.js');

const FAIL_THRESHOLD = 3;
const COOLDOWN_MS    = 120_000;

const STATE = { CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half-open' };

class KeySlot {
  constructor(key, index) {
    this.key        = key;
    this.index      = index;
    this.state      = STATE.CLOSED;
    this.failStreak = 0;
    this.openAt     = 0;
  }

  canAttempt() {
    if (this.state === STATE.CLOSED)    return true;
    if (this.state === STATE.HALF_OPEN) return true;
    if (this.state === STATE.OPEN) {
      const elapsed = Date.now() - this.openAt;
      if (elapsed >= COOLDOWN_MS) {
        this.state = STATE.HALF_OPEN;
        log('info', 'key_pool', 'key_half_open', { keyIndex: this.index, elapsedMs: elapsed });
        return true;
      }
    }
    return false;
  }

  cooldownRemainingMs() {
    if (this.state !== STATE.OPEN) return 0;
    return Math.max(0, COOLDOWN_MS - (Date.now() - this.openAt));
  }

  recordSuccess() {
    if (this.state === STATE.HALF_OPEN) {
      log('info', 'key_pool', 'key_recovered', { keyIndex: this.index });
    }
    this.state      = STATE.CLOSED;
    this.failStreak = 0;
  }

  recordFailure() {
    this.failStreak++;
    if (this.state === STATE.HALF_OPEN || this.failStreak >= FAIL_THRESHOLD) {
      this.state  = STATE.OPEN;
      this.openAt = Date.now();
      log('warn', 'key_pool', 'key_tripped', {
        keyIndex:   this.index,
        failStreak: this.failStreak,
        cooldownMs: COOLDOWN_MS,
      });
      metrics.increment('groq_key_tripped', { keyIndex: String(this.index) });
    }
  }

  snapshot() {
    return {
      index:               this.index,
      state:               this.state,
      failStreak:          this.failStreak,
      cooldownRemainingMs: this.cooldownRemainingMs(),
    };
  }
}

class GroqKeyPool {
  constructor(keys) {
    this.slots = keys
      .map((k, i) => (k && k.trim() ? new KeySlot(k.trim(), i) : null))
      .filter(Boolean);

    if (this.slots.length === 0) {
      throw new Error('GroqKeyPool: no valid API keys provided');
    }
    log('info', 'key_pool', 'pool_initialized', { keyCount: this.slots.length });
  }

  getActiveSlot() {
    for (const slot of this.slots) {
      if (slot.canAttempt()) {
        return { key: slot.key, index: slot.index };
      }
    }
    log('warn', 'key_pool', 'all_keys_open', { slots: this.slots.map(s => s.snapshot()) });
    metrics.increment('groq_all_keys_open');
    return null;
  }

  markSuccess(index) {
    const slot = this.slots.find(s => s.index === index);
    if (slot) slot.recordSuccess();
  }

  markFailure(index) {
    const slot = this.slots.find(s => s.index === index);
    if (slot) slot.recordFailure();
  }

  getHealthSnapshot() {
    return this.slots.map(s => s.snapshot());
  }
}

// --- Singleton -------------------------------------------------------------------
// Reads GROQ_API_KEY_1, GROQ_API_KEY_2, GROQ_API_KEY_3.
// Falls back to GROQ_API_KEY for _1 (backward-compat with existing .env).

function buildPool() {
  const k1 = process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY || '';
  const k2 = process.env.GROQ_API_KEY_2 || '';
  const k3 = process.env.GROQ_API_KEY_3 || '';
  return new GroqKeyPool([k1, k2, k3]);
}

let _pool = null;
function getPool() {
  if (!_pool) _pool = buildPool();
  return _pool;
}

module.exports = { getPool, GroqKeyPool, KeySlot, STATE };
