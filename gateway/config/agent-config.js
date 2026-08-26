const DECISION_LANGUAGE = /\b(approv|decid|agreed|agree|commit|deadline|due (date|by)|assign|owner|ship(ping)?|launch|go with|sign[- ]?off|budget|block(ed|er)?)\b/i;

const AGENT_CONFIG = {
  transcript_cleaner: { model: 'pending-discovery', timeoutMs: 2000,  retries: 0, tier: 'core' },
  context_manager:    { model: 'pending-discovery', timeoutMs: 8000,  retries: 1, tier: 'core' },
  explanation:        { model: 'pending-discovery', timeoutMs: 10000, retries: 1, tier: 'standard' },
  technical:          { model: 'pending-discovery', timeoutMs: 20000, retries: 1, tier: 'standard' },
  analyst:            { model: 'pending-discovery', timeoutMs: 20000, retries: 1, tier: 'deep' },
  risk:               { model: 'pending-discovery', timeoutMs: 20000, retries: 1, tier: 'deep' },
  response:           { model: 'pending-discovery', timeoutMs: 15000, retries: 1, tier: 'standard' },
};

module.exports = {
  DECISION_LANGUAGE,
  AGENT_CONFIG,
};
