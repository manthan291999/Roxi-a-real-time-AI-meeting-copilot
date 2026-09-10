const crypto = require('crypto');

function toSemanticPayload(row) {
  return {
    source_table: 'glossary_term',
    project_id: row.project_id || null,
    term: row.term,
    definition: row.definition,
    meeting_ids: row.meeting_ids, // array of ids
    last_seen: row.last_seen
  };
}

function generateSemanticId(term) {
  // Point ID must be a UUID for Qdrant. 
  // We use MD5 hash formatted as a UUID to ensure deterministic IDs for the same term.
  const hash = crypto.createHash('md5');
  hash.update(`glossary:${term.toLowerCase()}`);
  const hex = hash.digest('hex');
  
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-');
}

module.exports = {
  toSemanticPayload,
  generateSemanticId
};
