/**
 * Port: BudgetGuard — cost gating for chat LLM calls.
 *
 * The chatbot process is isolated from the capture pipeline's circuit
 * breaker, so it enforces its own per-process budget (same philosophy:
 * soft limit -> warn/degrade, hard limit -> refuse).
 *
 * @interface BudgetGuard
 * @method canCall    @returns {boolean} true if another LLM call is allowed now
 * @method recordCall records one successful LLM call against the budget
 * @method state      @returns {'closed'|'open'} current budget state
 * @method remaining  @returns {number} calls left before the hard limit
 */
module.exports = {};
