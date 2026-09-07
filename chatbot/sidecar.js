#!/usr/bin/env node
/**
 * Ask Roxi — chat sidecar entry point (spawned by the Rust/Tauri core).
 * Keeps this file trivially thin: config + container + transport only.
 */

const { buildContainer } = require('./src/composition/container');
const { startStdioSidecar } = require('./src/transport/stdioSidecar');

// --- Global resilience: never let the sidecar process die on an unhandled
// promise rejection or exception. Instead, emit a protocol-compliant Error
// so the frontend can surface a message rather than seeing a crash.
function emitError(message, code) {
  try {
    process.stdout.write(
      JSON.stringify({ type: 'Error', message: String(message), code }) + '\n'
    );
  } catch (_) { /* stdout might be closed — nothing we can do */ }
}

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  emitError(msg, 'UNHANDLED_REJECTION');
  // Do NOT exit — sidecar stays alive to handle the next question.
});

process.on('uncaughtException', (err) => {
  emitError(err.message, 'UNCAUGHT_EXCEPTION');
  // Do NOT exit — sidecar stays alive to handle the next question.
});

try {
  const container = buildContainer();
  startStdioSidecar(container);
} catch (err) {
  // Protocol-compliant fatal error during startup only, then exit.
  process.stdout.write(JSON.stringify({ type: 'Error', message: err.message, code: 'STARTUP_FAILED' }) + '\n');
  process.exit(1);
}
