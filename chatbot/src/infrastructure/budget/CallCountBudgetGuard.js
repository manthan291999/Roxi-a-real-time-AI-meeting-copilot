/**
 * CallCountBudgetGuard — BudgetGuard implementation.
 *
 * Per-process call accounting (same philosophy as the capture pipeline's
 * circuit breaker, but isolated: the chatbot must not share mutable state
 * with the capture sidecar). Soft limit logs warnings; hard limit refuses.
 */

class CallCountBudgetGuard {
  /**
   * @param {{softLimit?: number, hardLimit?: number, logger?: import('../../domain/ports/ChatLogger').ChatLogger}} [opts]
   */
  constructor({ softLimit = 60, hardLimit = 80, logger = null } = {}) {
    if (hardLimit < softLimit) hardLimit = softLimit;
    this.softLimit = softLimit;
    this.hardLimit = hardLimit;
    this.logger = logger;
    this.used = 0;
    this.softWarned = false;
  }

  canCall() {
    return this.used < this.hardLimit;
  }

  recordCall() {
    this.used += 1;
    if (this.used >= this.hardLimit) {
      this.logger?.error('budget', 'hard_limit_reached', { used: this.used, hardLimit: this.hardLimit });
    } else if (this.used >= this.softLimit && !this.softWarned) {
      this.softWarned = true;
      this.logger?.warn('budget', 'soft_limit_reached', { used: this.used, softLimit: this.softLimit });
    }
  }

  state() {
    return this.used >= this.hardLimit ? 'open' : 'closed';
  }

  remaining() {
    return Math.max(0, this.hardLimit - this.used);
  }
}

module.exports = { CallCountBudgetGuard };
