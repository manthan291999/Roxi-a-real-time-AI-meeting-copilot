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

/**
 * Parse an integer within [min, max], falling back to `fallback`.
 *
 * Out-of-range values fall back rather than clamp: these map onto STT provider
 * parameters with documented ranges, and a silently clamped value hides a typo
 * in a `.env` that would otherwise be obvious from the behaviour.
 */
function toBoundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/** Lowercase `value` if it is one of `allowed`, else `fallback`. */
function toEnum(value, allowed, fallback) {
  const normalized = String(value || '').toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
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
      roxiApiUrl: (resolved.ROXI_API_URL || '').replace(/\/$/, ''),
      roxiAccessToken: resolved.ROXI_ACCESS_TOKEN || null,
      /** Array of supported language codes for Automatic Language Detection (ALD) */
      languages: resolved.STT_LANGUAGES 
        ? resolved.STT_LANGUAGES.split(',').map((s) => s.trim())
        : ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'hi', 'ja', 'zh', 'ko'],
      /** Force a single provider; otherwise the full fallback chain is used. */
      forced: resolved.STT_PROVIDER ? resolved.STT_PROVIDER.toLowerCase() : null,

      /**
       * Turn-detection and audio tuning, passed straight through to the
       * provider's streaming session.
       *
       * The defaults are deliberately not AssemblyAI's own (100ms / 1000ms):
       * those are tuned for voice agents, where cutting a turn early is cheap
       * because the user can interrupt. This is multi-person meeting audio,
       * where people pause mid-thought and an early cut splits one idea across
       * two chunks — which then reach the agent pipeline as two unrelated
       * fragments. These sit between AssemblyAI's defaults and the much longer
       * values they replace.
       */
      minTurnSilence: toBoundedInt(resolved.STT_MIN_TURN_SILENCE, 400, 50, 10000),
      maxTurnSilence: toBoundedInt(resolved.STT_MAX_TURN_SILENCE, 1500, 400, 10000),
      /** Diarization cap. Universal-3.5-Pro supports up to 10. */
      maxSpeakers: toBoundedInt(resolved.STT_MAX_SPEAKERS, 10, 1, 10),
      /** Latency/accuracy preset. `max_accuracy` suits noisy far-field rooms. */
      mode: toEnum(resolved.STT_MODE, ['balanced', 'max_accuracy', 'min_latency'], 'balanced'),
      /**
       * Background-noise suppression, off by default: the primary source here
       * is BlackHole loopback, which is already-clean audio from the
       * conferencing app, and suppression bills extra per hour. Worth enabling
       * (`far-field`) when the mic in an open room is the main input.
       */
      voiceFocus: toEnum(resolved.STT_VOICE_FOCUS, ['near-field', 'far-field'], null),
    }),

    meeting: Object.freeze({
      /** The human-chosen title asked for by the intake modal. */
      name: readArg(argv, '--meeting-name') || '',

      /**
       * Used twice: the Rust agent pipeline builds its own prompts from its own
       * copy, and the STT provider takes this as a recognition hint
       * (`prompt` / `keyterms_prompt`) so names said aloud are spelled the way
       * the user typed them.
       */
      context: readArg(argv, '--context') || '',
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

      /**
       * The signed-in account that owns this meeting (a Supabase user id).
       * Absent in local-only mode, where the meeting belongs to no account
       * and every meeting on this Mac is visible.
       */
      accountId: readArg(argv, '--account-id') || null,
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
  const serverBacked = config.stt.roxiApiUrl && config.stt.roxiAccessToken;
  if (!config.stt.assemblyaiKey && !config.stt.speechmaticsKey && !serverBacked) {
    missing.push('Roxi sign-in or a development STT provider key');
  }
  return missing.length > 0 ? { ok: false, missing } : { ok: true };
}

module.exports = { load, validate };
