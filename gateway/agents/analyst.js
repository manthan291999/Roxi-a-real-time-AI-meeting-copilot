const { callGroq } = require('../llm/groq-client.js');
const { validateAnalystOutput } = require('../infrastructure/validate.js');
const { meetingState } = require('../state/meeting-state.js');
const { buildMeetingContextBlock, buildRecentConversationBlock } = require('../state/prompt-builder.js');
const { AGENT_CONFIG } = require('../config/agent-config.js');

const meetingAnalystAgent = {
  name: 'analyst',
  validate: validateAnalystOutput,
  async run(chunkText, speaker) {
    const messages = [
      { role: 'system', content: `You are a Meeting Analyst.` },
      { role: 'user', content: `Review the latest transcript chunk and extract any clear decisions or action items.
${buildMeetingContextBlock()}
[RECENT CONVERSATION]
${buildRecentConversationBlock()}

[CURRENT CHUNK]
Speaker: ${speaker}
Text: "${chunkText}"

Current Topic: ${meetingState.current_topic}
Current Summary: ${meetingState.conversation_summary}

Task:
Extract any explicit decisions made and action items assigned in this chunk.
If there are none, return empty arrays.

Output strictly as JSON:
{
  "new_decisions": [
    { "text": "Decision description", "confidence": 0.9 }
  ],
  "new_action_items": [
    { "text": "Task description", "assignee": "Person Name (or null)", "deadline": "Date/Time (or null)" }
  ]
}` },
    ];
    return callGroq({ messages, expectJson: true, tag: this.name, ...AGENT_CONFIG[this.name] });
  },
};

module.exports = { meetingAnalystAgent };
