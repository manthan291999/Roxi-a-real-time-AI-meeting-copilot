#!/usr/bin/env node
/**
 * Ask Roxi — chat sidecar entry point (spawned by the Rust/Tauri core).
 * Keeps this file trivially thin: config + container + transport only.
 */

const { buildContainer } = require('./src/composition/container');
const { startStdioSidecar } = require('./src/transport/stdioSidecar');

try {
  const container = buildContainer();
  startStdioSidecar(container);
} catch (err) {
  // Protocol-compliant fatal error, then non-zero exit.
  process.stdout.write(JSON.stringify({ type: 'Error', message: err.message, code: 'STARTUP_FAILED' }) + '\n');
  process.exit(1);
}
