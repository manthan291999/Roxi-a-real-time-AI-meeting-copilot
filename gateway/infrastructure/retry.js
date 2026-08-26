const MAX_RETRY_AFTER_MS = 10000;

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateBackoff(attempt) {
  return 1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
}

function parseRetryAfterHeader(headerValue) {
  if (!headerValue) return null;
  const secs = Number(headerValue);
  if (!Number.isFinite(secs) || secs < 0) return null;
  return Math.min(secs * 1000, MAX_RETRY_AFTER_MS);
}

class RetryPolicy {
  constructor({ maxRetries, retryableStatuses = new Set() }) {
    this.maxRetries = maxRetries;
    this.retryableStatuses = retryableStatuses;
  }

  isRetryable(status) {
    return this.retryableStatuses.has(status);
  }
}

module.exports = {
  sleepMs,
  calculateBackoff,
  parseRetryAfterHeader,
  RetryPolicy,
};
