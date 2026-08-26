const { meetingState } = require('./meeting-state.js');
const { getSpeakerStats } = require('./speaker-tracker.js');

function buildMeetingContextBlock() {
  const ctx = meetingState.user_context;
  if (!ctx) return '';
  return `
[MEETING BRIEFING — HIGH PRIORITY]
The user has specified the following meeting context/agenda:
"${ctx}"

You MUST prioritize analysis around this topic. When evaluating significance,
conversations directly related to this briefing should be scored HIGHER.
When generating explanations and responses, frame them in the context of
this briefing. If the conversation drifts away from this topic, note the
drift but still analyze what is being discussed.
`;
}

function buildRecentConversationBlock() {
  if (meetingState.recent_chunks.length === 0) return 'None';
  return meetingState.recent_chunks
    .map((c) => `[${c.speaker}]: ${c.text}`)
    .join('\n');
}

function buildGlossaryBlock() {
  if (meetingState.technical_terms.size === 0) return 'None';
  return Array.from(meetingState.technical_terms.entries())
    .map(([t, d]) => `${t}: ${d}`)
    .join('\n');
}

function buildSpeakerProfilesBlock() {
  const stats = getSpeakerStats();
  if (!stats || stats.length === 0) return 'No profiles established yet.';
  
  const lines = [];
  for (const data of stats) {
    const topics = data.topics.join(', ');
    lines.push(`- ${data.name}: Discussed ${data.chunkCount} times. Core topics: ${topics || 'None yet'}`);
  }
  return lines.join('\n');
}

module.exports = {
  buildMeetingContextBlock,
  buildRecentConversationBlock,
  buildGlossaryBlock,
  buildSpeakerProfilesBlock,
};
