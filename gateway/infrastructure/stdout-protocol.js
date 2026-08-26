/**
 * Standardized typed event emission for the Rust backend protocol.
 */

function emit(type, payload = {}) {
  console.log(JSON.stringify({ type, ...payload }));
}

function emitFinalTranscript(text, speaker, sttLabel, start, end) {
  emit('Final', { text, speaker, sttLabel, start, end });
}

function emitPartialTranscript(text, speaker, sttLabel) {
  emit('Partial', { text, speaker, sttLabel });
}

function emitExplanation(text, speaker) {
  emit('Explanation', { text, speaker });
}

function emitTechnicalExplanation(text, speaker) {
  emit('TechnicalExplanation', { text, speaker });
}

function emitSignificance(level) {
  emit('Significance', { level });
}

function emitDecisions(items) {
  emit('Decisions', { items });
}

function emitActionItems(items) {
  emit('ActionItems', { items });
}

function emitRisks(items) {
  emit('Risks', { items });
}

function emitSuggestedResponse(text, speaker) {
  emit('Response', { text, speaker });
}

function emitCircuitBreakerState(snapshot) {
  emit('CircuitBreaker', { items: snapshot });
}

function emitBilling(snapshot) {
  emit('Billing', { items: { snapshot } });
}

function emitCostAnomaly(rule, label, value, threshold) {
  emit('CostAnomaly', { rule, label, value, threshold });
}

function emitProviderStatus(provider, state) {
  emit('ProviderStatus', { provider, state });
}

function emitConnected(sessionId) {
  emit('Connected', { sessionId });
}

function emitApiHealth(keys) {
  emit('ApiHealth', { items: { keys } });
}

function emitError(message) {
  emit('Error', { message });
}

function emitSpeakerRevision(revision) {
  emit('SpeakerRevision', { revision });
}

module.exports = {
  emit,
  emitFinalTranscript,
  emitPartialTranscript,
  emitExplanation,
  emitTechnicalExplanation,
  emitSignificance,
  emitDecisions,
  emitActionItems,
  emitRisks,
  emitSuggestedResponse,
  emitCircuitBreakerState,
  emitBilling,
  emitProviderStatus,
  emitConnected,
  emitApiHealth,
  emitError,
  emitSpeakerRevision,
  emitCostAnomaly,
};
