// State for the current meeting
const { exceedsSimilarityThreshold } = require('../infrastructure/text-similarity.js');

const MAX_RECENT_CHUNKS = 10;
const MAX_GLOSSARY_TERMS = 100;
const MAX_IN_MEMORY_RISKS = 50;
const MAX_PAST_SUGGESTIONS = 20;

const meetingState = {
  user_context: '',
  user_profile: {
    role: 'Senior AI Engineer',
    company: 'Google',
    experience_years: 5,
    expertise_level: 'expert',
    technical_depth: 'high',
  },
  current_topic: 'Unknown',
  conversation_summary: '',
  technical_terms: new Map(), // LRU: term -> definition (insertion order)
  recent_chunks: [],
  speaker_map: {},
  risks: [],
  past_suggestions: [],
};

function setMeetingContext(context) {
  meetingState.user_context = context || '';
  meetingState.current_topic = context || 'Unknown';
}

function setUserProfile(profile) {
  if (!profile) return;
  if (profile.role) meetingState.user_profile.role = profile.role;
  if (profile.company) meetingState.user_profile.company = profile.company;
  if (profile.experience_years) meetingState.user_profile.experience_years = profile.experience_years;
  if (profile.expertise_level) meetingState.user_profile.expertise_level = profile.expertise_level;
  if (profile.technical_depth) meetingState.user_profile.technical_depth = profile.technical_depth;
}

function getMeetingState() {
  return meetingState;
}

function updateFromContextManager(data) {
  if (data.topic) meetingState.current_topic = data.topic;
  if (data.conversation_summary) meetingState.conversation_summary = data.conversation_summary;
}

function addRecentChunk(speaker, text, significance) {
  meetingState.recent_chunks.push({ speaker, text, significance });
  if (meetingState.recent_chunks.length > MAX_RECENT_CHUNKS) {
    meetingState.recent_chunks.shift();
  }
}

function mergeGlossary(terms) {
  for (const [term, definition] of Object.entries(terms)) {
    // Re-insert to refresh LRU position.
    meetingState.technical_terms.delete(term);
    meetingState.technical_terms.set(term, definition);
  }

  // Enforce capacity
  if (meetingState.technical_terms.size > MAX_GLOSSARY_TERMS) {
    const overflow = meetingState.technical_terms.size - MAX_GLOSSARY_TERMS;
    const iterator = meetingState.technical_terms.keys();
    for (let i = 0; i < overflow; i++) {
      meetingState.technical_terms.delete(iterator.next().value);
    }
  }
}

function addRisks(risks) {
  meetingState.risks.push(...risks);
  if (meetingState.risks.length > MAX_IN_MEMORY_RISKS) {
    meetingState.risks.splice(0, meetingState.risks.length - MAX_IN_MEMORY_RISKS);
  }
}

function addSuggestion(text) {
  meetingState.past_suggestions.push(text);
  if (meetingState.past_suggestions.length > MAX_PAST_SUGGESTIONS) {
    meetingState.past_suggestions.shift();
  }
}

function hasDuplicateSuggestion(text) {
  const recentWindow = meetingState.past_suggestions.slice(-5);
  return exceedsSimilarityThreshold(recentWindow, text, 0.82);
}

function reset() {
  meetingState.user_context = '';
  meetingState.user_profile = {
    role: 'Senior AI Engineer',
    company: 'Google',
    experience_years: 5,
    expertise_level: 'expert',
    technical_depth: 'high',
  };
  meetingState.current_topic = 'Unknown';
  meetingState.conversation_summary = '';
  meetingState.technical_terms.clear();
  meetingState.recent_chunks = [];
  meetingState.speaker_map = {};
  meetingState.risks = [];
  meetingState.past_suggestions = [];
}

module.exports = {

  meetingState,
  setMeetingContext,
  setUserProfile,
  updateFromContextManager,
  addRecentChunk,
  mergeGlossary,
  addRisks,
  addSuggestion,
  hasDuplicateSuggestion,
  reset,
  getMeetingState,
};
