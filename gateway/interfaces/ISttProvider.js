/**
 * ISttProvider — the contract every STT provider must satisfy.
 *
 * This used to be `module.exports = {}` under a JSDoc comment, which nothing
 * referenced and nothing enforced. That is how the two providers came to
 * disagree about whether a `final` event carries `confidence` — a divergence
 * that silently disabled the low-confidence filter whenever the app failed over
 * to the provider that omitted it.
 *
 * JavaScript has no interfaces, so conformance is asserted at runtime instead,
 * exercised by test/stt-provider-contract.test.js against every provider.
 *
 * Required methods:
 *   connect(): Promise<void>   resolves once the session is live, rejects on failure
 *   sendAudio(Buffer): void    non-blocking; a no-op when not connected
 *   close(): Promise<void>     best-effort teardown, never throws
 *
 * Required property:
 *   name: string               stable identifier used in status events
 *
 * Required events (EventEmitter):
 *   'connected'        { sessionId }
 *   'partial'          { text, speaker }
 *   'final'            { text, speaker, start, end, confidence }
 *                      confidence is REQUIRED: a number in [0, 1].
 *   'error'            { message, fatal }
 *   'closed'           { code, reason }
 *
 * Optional events:
 *   'speakerRevision'  { revisions }  only providers that revise labels;
 *                      an array of corrections, not a single one
 */

'use strict';

const REQUIRED_METHODS = ['connect', 'sendAudio', 'close'];
const REQUIRED_EVENTS = ['connected', 'partial', 'final', 'error', 'closed'];

/**
 * Assert that an instance structurally satisfies ISttProvider.
 *
 * @param {Object} provider
 * @returns {{ok: boolean, problems: string[]}}
 */
function checkSttProvider(provider) {
  const problems = [];

  if (!provider || typeof provider !== 'object') {
    return { ok: false, problems: ['not an object'] };
  }
  if (typeof provider.name !== 'string' || !provider.name) {
    problems.push('missing string property `name`');
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof provider[method] !== 'function') {
      problems.push(`missing method \`${method}()\``);
    }
  }
  // EventEmitter surface — the manager subscribes to all of REQUIRED_EVENTS.
  if (typeof provider.on !== 'function' || typeof provider.emit !== 'function') {
    problems.push('not an EventEmitter');
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Validate a `final` event payload. The confidence field is the specific term
 * of the contract that was previously unenforced, so it is checked explicitly.
 *
 * @returns {{ok: boolean, problems: string[]}}
 */
function checkFinalEvent(event) {
  const problems = [];
  if (!event || typeof event !== 'object') {
    return { ok: false, problems: ['not an object'] };
  }
  if (typeof event.text !== 'string' || !event.text) problems.push('`text` must be a non-empty string');
  if (typeof event.speaker !== 'string' || !event.speaker) problems.push('`speaker` must be a non-empty string');
  if (typeof event.confidence !== 'number' || !Number.isFinite(event.confidence)) {
    problems.push('`confidence` must be a finite number');
  } else if (event.confidence < 0 || event.confidence > 1) {
    problems.push('`confidence` must be within [0, 1]');
  }
  return { ok: problems.length === 0, problems };
}

module.exports = { checkSttProvider, checkFinalEvent, REQUIRED_METHODS, REQUIRED_EVENTS };
