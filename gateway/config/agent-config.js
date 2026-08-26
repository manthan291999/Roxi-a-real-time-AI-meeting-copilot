const DECISION_LANGUAGE = /\b(approv|decid|agreed|agree|commit|deadline|due (date|by)|assign|owner|ship(ping)?|launch|go with|sign[- ]?off|budget|block(ed|er)?)\b/i;

const AGENT_CONFIG = {
  transcript_cleaner: { timeoutMs: 2000,  retries: 0, maxTokens: 256, tier: 'core' },
  context_manager:    { timeoutMs: 8000,  retries: 1, maxTokens: 400, tier: 'core' },
  explanation:        { timeoutMs: 10000, retries: 1, maxTokens: 300, tier: 'standard' },
  technical:          { timeoutMs: 20000, retries: 1, maxTokens: 400, tier: 'standard' },
  analyst:            { timeoutMs: 20000, retries: 1, maxTokens: 512, tier: 'deep' },
  risk:               { timeoutMs: 20000, retries: 1, maxTokens: 400, tier: 'deep' },
  response:           { timeoutMs: 15000, retries: 1, maxTokens: 150, tier: 'standard' },
};

module.exports = {
  DECISION_LANGUAGE,
  AGENT_CONFIG,
};
