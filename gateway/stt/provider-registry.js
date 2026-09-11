/**
 * AI Meeting Interpreter — STT Provider Registry
 *
 * Maps provider names to their credential and constructor, so building the
 * fallback chain is data-driven. Adding a third provider means adding one entry
 * here and nothing else — previously it meant editing the composition root in
 * three separate places (import, credential lookup, chain push).
 *
 * Order in PROVIDER_ORDER is the fallback order.
 */

'use strict';

const { AssemblyAIProvider } = require('../providers/assemblyai.js');
const { SpeechmaticsProvider } = require('../providers/speechmatics.js');
const { policyFor } = require('../infrastructure/retry.js');

const REGISTRY = Object.freeze({
  assemblyai: Object.freeze({
    credential: (sttConfig) => sttConfig.assemblyaiKey,
    create: (key, sttConfig, meetingConfig) =>
      new AssemblyAIProvider(key, sttConfig.languages, {
        minTurnSilence: sttConfig.minTurnSilence,
        maxTurnSilence: sttConfig.maxTurnSilence,
        maxSpeakers: sttConfig.maxSpeakers,
        mode: sttConfig.mode,
        voiceFocus: sttConfig.voiceFocus,
        // The meeting context the user typed at intake. AssemblyAI takes it as
        // a recognition hint, which is the largest accuracy win available here
        // and costs nothing extra — the process already has the string.
        context: meetingConfig.context,
        role: meetingConfig.role,
      }),
  }),
  speechmatics: Object.freeze({
    credential: (sttConfig) => sttConfig.speechmaticsKey,
    create: (key, sttConfig) => new SpeechmaticsProvider(key, sttConfig.languages),
  }),
});

/** Fallback order: primary first. */
const PROVIDER_ORDER = Object.freeze(['assemblyai', 'speechmatics']);

/**
 * Build the ordered chain of provider descriptors for ProviderManager, skipping
 * any provider without a credential and honouring a forced single provider.
 *
 * @param {{assemblyaiKey: ?string, speechmaticsKey: ?string, forced: ?string}} sttConfig
 * @param {{context: string, role: ?string}} [meetingConfig] the intake context,
 *        passed to providers that can use it as a recognition hint
 * @returns {Array<{name: string, create: Function, retryPolicy: Object}>}
 */
function buildChain(sttConfig, meetingConfig = { context: '', role: null }) {
  const names = sttConfig.forced
    ? PROVIDER_ORDER.filter((n) => n === sttConfig.forced)
    : PROVIDER_ORDER;

  const available = names
    .map((name) => ({ name, entry: REGISTRY[name] }))
    .filter(({ entry }) => entry && entry.credential(sttConfig));

  return available.map(({ name, entry }, index) => ({
    name,
    create: () => entry.create(entry.credential(sttConfig), sttConfig, meetingConfig),
    retryPolicy: policyFor(index, available.length),
  }));
}

module.exports = { buildChain, REGISTRY, PROVIDER_ORDER };
