const db = require('../db/index.js');

function persistChunkArtifacts(result, seq, speaker, text) {
  const chunkId = db.saveChunk(seq, speaker, text, result.chunk_significance);

  if (result.risks && result.risks.length > 0) {
    db.saveRisks(chunkId, result.risks);
  }

  if (result.new_technical_terms && Object.keys(result.new_technical_terms).length > 0) {
    db.upsertGlossary(result.new_technical_terms);
  }

  if (result.api_calls_used > 0) {
    db.incrementApiCalls(result.api_calls_used);
  }

  if (result.decisions && result.decisions.length > 0) {
    result.decisions.forEach(d => db.saveDecision(chunkId, d));
  }

  if (result.action_items && result.action_items.length > 0) {
    result.action_items.forEach(a => db.saveActionItem(chunkId, a));
  }

  if (result.current_explanation || result.technical_explanation) {
    db.saveTechnicalAnalysis(chunkId, result.current_explanation, result.technical_explanation);
  }

  if (result.suggested_response) {
    db.saveSuggestedReply(chunkId, result.suggested_response);
  }

  return chunkId;
}

module.exports = { persistChunkArtifacts };
