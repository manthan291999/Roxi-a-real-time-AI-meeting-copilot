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
const configured = (process.env.LOG_LEVEL || 'info').toLowerCase();
const threshold = LEVELS[configured] != null ? LEVELS[configured] : LEVELS.info;

/** Short preview of user-generated text; safe to log. */
function textPreview(text, max = 8) {
  if (typeof text !== 'string') return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
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

/**
 * Basic metrics hooks. Default implementation emits greppable log lines;
 * swap `metrics.sink` for a real collector (Prometheus push, OTLP, …) later.
 */
const metrics = {
  sink: (name, value, tags, kind) => {
    log('info', 'metrics', 'metric', { metric: name, kind, value, ...tags });
  },
  /** Count occurrences (counters). */
  increment(name, tags = {}) {
    try { this.sink(name, 1, tags, 'counter'); } catch (_) { /* never throw */ }
  },
  /** Record a magnitude (latency ms, token counts, sizes…). */
  observe(name, value, tags = {}) {
    try { this.sink(name, value, tags, 'gauge'); } catch (_) { /* never throw */ }
  },
};

module.exports = { log, metrics, textPreview, LEVELS };
