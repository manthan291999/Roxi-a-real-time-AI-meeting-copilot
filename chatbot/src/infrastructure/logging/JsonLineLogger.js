/**
 * JsonLineLogger — ChatLogger implementation writing JSON lines to STDERR.
 *
 * stdout is reserved for the sidecar JSON protocol, so all diagnostics go to
 * stderr (Tauri captures them for debugging; CLI users see them inline).
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

class JsonLineLogger {
  /** @param {{level?: string, sink?: (line:string)=>void}} [opts] */
  constructor({ level = 'info', sink = null } = {}) {
    this.minLevel = LEVELS[level] ?? LEVELS.info;
    this.sink = sink || ((line) => process.stderr.write(line + '\n'));
  }

  _emit(level, scope, event, meta) {
    if (LEVELS[level] < this.minLevel) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      scope,
      event,
      ...(meta && Object.keys(meta).length ? { meta } : {}),
    });
    this.sink(line);
  }

  debug(scope, event, meta) { this._emit('debug', scope, event, meta); }
  info(scope, event, meta) { this._emit('info', scope, event, meta); }
  warn(scope, event, meta) { this._emit('warn', scope, event, meta); }
  error(scope, event, meta) { this._emit('error', scope, event, meta); }
}

module.exports = { JsonLineLogger };
