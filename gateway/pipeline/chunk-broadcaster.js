const protocol = require('../infrastructure/stdout-protocol.js');
const billingTracker = require('../infrastructure/billing-tracker.js');

function broadcastChunkEvents(result, speaker) {
  if (result.chunk_significance && result.chunk_significance !== 'none') {
    protocol.emitSignificance(result.chunk_significance);
  }
  if (result.current_explanation) {
    protocol.emitExplanation(result.current_explanation, speaker);
  }
  if (result.technical_explanation) {
    protocol.emitTechnicalExplanation(result.technical_explanation, speaker);
  }
  if (result.decisions && result.decisions.length > 0) {
    protocol.emitDecisions(result.decisions);
  }
  if (result.action_items && result.action_items.length > 0) {
    protocol.emitActionItems(result.action_items);
  }
  if (result.risks && result.risks.length > 0) {
    protocol.emitRisks(result.risks);
  }
  if (result.suggested_response) {
    protocol.emitSuggestedResponse(result.suggested_response, speaker, result.suggested_response_type);
  }
  if (result.breaker && (result.breaker.state === 'degraded' || result.breaker.state === 'open')) {
    protocol.emitCircuitBreakerState(result.breaker);
  }
  
  // Always emit billing snapshot
  protocol.emitBilling(billingTracker.getSnapshot());
}

module.exports = { broadcastChunkEvents };
