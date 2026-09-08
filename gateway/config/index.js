/**
 * AI Meeting Interpreter — Gateway Configuration
 *
 * The single place the gateway reads `process.env`, `process.argv`, or resolves
 * a filesystem path. Everything else receives a frozen config object, which is
 * what makes the rest of the folder testable without a real environment.
 *
 * Env resolution matches the rule in CLAUDE.md: the root `.env` (shared with the
 * Rust host) wins; `gateway/.env` is a backwards-compatible fallback. Packaged
 * `.app` bundles do not inherit a shell environment, so this must not depend on
 * one being present.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const GATEWAY_DIR = path.join(__dirname, '..');
const ROOT_ENV = path.join(GATEWAY_DIR, '..', '.env');
const LOCAL_ENV = path.join(GATEWAY_DIR, '.env');

/**
 * Parse a positive integer, or null.
 *
 * Anything else — absent, empty, `NaN`, `0`, negative — is null rather than a
 * number the repository would then have to re-validate.
 */
function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Read one `--flag value` pair out of argv. */
function readArg(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return null;
  const value = argv[idx + 1];
  return value && !value.startsWith('--') ? value : null;
}

/**
 * Build the config object. Exported as a function (rather than executed at
 * import time) so tests can supply their own env/argv.
 *
 * @param {Object}   [opts]
 * @param {Object}   [opts.env=process.env]
 * @param {string[]} [opts.argv=process.argv]
 * @returns {Readonly<Object>}
 */
function load({ env = process.env, argv = process.argv } = {}) {
  require('dotenv').config({
    path: fs.existsSync(ROOT_ENV) ? ROOT_ENV : LOCAL_ENV,
  });

  // dotenv mutates process.env, so re-read when the caller did not inject one.
  const resolved = env === process.env ? process.env : env;

  const assemblyaiKey = resolved.ASSEMBLYAI_API_KEY || null;
  const speechmaticsKey = resolved.SPEECHMATICS_API_KEY || null;

  return Object.freeze({
    logLevel: (resolved.LOG_LEVEL || 'info').toLowerCase(),

    dbPath: resolved.MEETING_DB_PATH || path.join(GATEWAY_DIR, 'meeting_history.db'),

    stt: Object.freeze({
      assemblyaiKey,
      speechmaticsKey,
      /** Force a single provider; otherwise the full fallback chain is used. */
      forced: resolved.STT_PROVIDER ? resolved.STT_PROVIDER.toLowerCase() : null,
    }),

    meeting: Object.freeze({
      context: readArg(argv, '--context') || '',
      /**
       * Accepted because the Rust host sends it (gateway_client.rs), but not
       * consumed here: prompt construction lives in the Rust agent pipeline,
       * which builds its own profile. Kept so the CLI contract stays stable.
       */
      role: readArg(argv, '--role') || null,

      /**
       * The project the Rust host resolved. It owns the picker and the
       * `projects` table; this process only files the meeting under the id it
       * is given, and falls back to `Unsorted` if that id no longer resolves.
       *
       * `--project-code` is accepted so `display_id` can be built without a
       * second query, but the id is authoritative — the code is re-read from
       * the row that the id resolves to.
       */
      projectId: toPositiveInt(readArg(argv, '--project-id')),
      projectCode: readArg(argv, '--project-code') || null,
    }),
  });
}

/**
 * Validate that the process can actually do its job.
 * @returns {{ok: true} | {ok: false, missing: string[]}}
 */
function validate(config) {
  const missing = [];
  if (!config.stt.assemblyaiKey && !config.stt.speechmaticsKey) {
    missing.push('ASSEMBLYAI_API_KEY or SPEECHMATICS_API_KEY');
  }
  return missing.length > 0 ? { ok: false, missing } : { ok: true };
}

module.exports = { load, validate };
