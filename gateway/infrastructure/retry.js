/**
 * AI Meeting Interpreter — Connect Retry Policies
 *
 * `ProviderManager.connectWithRetry()` reads `descriptor.retryPolicy`. Before
 * this module existed the chain descriptors never set that field, so the policy
 * silently defaulted to `{ maxRetries: 0 }` — meaning exactly one connect
 * attempt per provider, with none of the documented backoff. These are the
 * policies that make that machinery live.
 *
 * Backoff is per-attempt and explicit rather than computed, so the total worst
 * case before failing over is obvious at a glance.
 */

'use strict';

/**
 * Primary provider: retried harder, because falling through to the fallback
 * costs a reconnect and a ring-buffer replay.
 */
const PRIMARY = Object.freeze({
  maxRetries: 2,
  backoffMs: Object.freeze([500, 2000]), // worst case ~2.5s before failover
});

/**
 * Last provider in the chain: there is nothing to fall through to, so it is
 * retried more patiently before the session is declared exhausted.
 */
const LAST_RESORT = Object.freeze({
  maxRetries: 3,
  backoffMs: Object.freeze([500, 2000, 5000]), // worst case ~7.5s
});

/**
 * Pick a policy by position in the chain.
 * @param {number} index  0-based position
 * @param {number} length total providers in the chain
 */
function policyFor(index, length) {
  return index === length - 1 ? LAST_RESORT : PRIMARY;
}

module.exports = { PRIMARY, LAST_RESORT, policyFor };
