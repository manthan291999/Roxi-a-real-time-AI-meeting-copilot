const { callGroq } = require('../llm/groq-client.js');
const { validateContextManagerOutput } = require('../infrastructure/validate.js');
const { meetingState } = require('../state/meeting-state.js');
const { buildMeetingContextBlock, buildRecentConversationBlock, buildSpeakerProfilesBlock } = require('../state/prompt-builder.js');
const { AGENT_CONFIG } = require('../config/agent-config.js');

const contextManagerAgent = {
  name: 'context_manager',
  validate: validateContextManagerOutput,
  async run(chunkText, speaker) {
    const messages = [
      { role: 'system', content: `You are the Context Manager for a real-time meeting copilot used by senior consultants at Big 4 firms. You track conversation flow and detect topic shifts.` },
      { role: 'user', content: `${buildMeetingContextBlock()}
[RECENT CONVERSATION]
${buildRecentConversationBlock()}

[CURRENT CHUNK]
Speaker: ${speaker}
Text: "${chunkText}"

[SPEAKER PROFILES]
${buildSpeakerProfilesBlock()}

Current Topic: ${meetingState.current_topic}
Current Summary: ${meetingState.conversation_summary}

Task:
1. Update the topic if it has changed.
2. Update the summary if necessary (keep it 1-2 sentences).
3. Extract any NEW technical terms, acronyms, or jargon used in this chunk and provide a brief, plain-language definition for non-technical listeners.

Output strictly as JSON:
{
  "current_topic": "...",
  "conversation_summary": "...",
  "new_technical_terms": { "term": "definition" }
}` },
    ];
    return callGroq({ messages, expectJson: true, tag: this.name, ...AGENT_CONFIG[this.name] });
  },
};

module.exports = { contextManagerAgent };
