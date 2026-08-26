const db = require('../db/index.js');
const { log } = require('../infrastructure/logger.js');

function persistChunkArtifacts(result, seq, speaker, chunkText) {
  try {
    db.saveChunk(seq, speaker, chunkText,
      result.chunk_significance, result.current_topic);
    if (result.decisions?.length)
      db.saveDecisions(result.decisions);
    if (result.action_items?.length)
      db.saveActionItems(result.action_items);
    if (result.risks?.length)
      db.saveRisks(result.risks);
    if (result.suggested_response)
      db.saveSuggestedReply(result.suggested_response);
    if (result.new_technical_terms &&
        Object.keys(result.new_technical_terms).length > 0)
      db.saveGlossaryTerms(result.new_technical_terms);
  } catch (err) {
    log('error', 'persister', 'persist_failed', { seq, error: err.message });
  }
}

module.exports = { persistChunkArtifacts };
