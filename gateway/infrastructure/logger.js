/**
 * AI Meeting Interpreter — Structured Logger
 *
 * One JSON object per line, written to STDERR only. Stdout is reserved for
 * the event protocol consumed by the Rust backend — never write logs there.
 *
 * Redaction rules:
 *  - API keys / Authorization headers are never logged.
 *  - Transcript text is logged as an 8-char preview at info level.
 *  - Provider/LLM error bodies are truncated by the callers.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

// Configured once via configure(); until then, default to 'info'. The logger is
// required by modules that load before config is built, so it cannot itself read
// process.env — see config/index.js, which owns all environment access.
let threshold = LEVELS.info;

/** Set the minimum level to emit. Called once from the composition root. */
function configure(level) {
  const resolved = LEVELS[String(level || '').toLowerCase()];
  if (resolved != null) threshold = resolved;
}

/**
 * Emit a structured log line to stderr.
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} component  e.g. 'sidecar' | 'agent' | 'groq' | 'db'
 * @param {string} event      short snake_case event name
 * @param {Object} [fields]   extra structured fields (must be JSON-safe)
 */
function log(level, component, event, fields = {}) {
  if ((LEVELS[level] || 0) < threshold) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    component,
    event,
    ...fields,
  });
  process.stderr.write(line + '\n');
}

module.exports = { log, configure, LEVELS };
