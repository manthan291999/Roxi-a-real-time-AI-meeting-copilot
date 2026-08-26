const { callGroq } = require('../llm/groq-client.js');
const { meetingState } = require('../state/meeting-state.js');
const { buildMeetingContextBlock, buildRecentConversationBlock } = require('../state/prompt-builder.js');
const { AGENT_CONFIG } = require('../config/agent-config.js');

const responseAgent = {
  name: 'response',
  async run(chunkText, speaker) {
    const messages = [
      { role: 'system', content: `You are an expert AI Meeting Copilot assisting a non-technical stakeholder (e.g., Project Manager, Client, Business Leader) in an IT/Software company.` },
      { role: 'user', content: `[OBJECTIVE]
Generate a short, confident, and business-focused suggested reply or clarifying question the stakeholder can say right now in response to the technical discussion.
${buildMeetingContextBlock()}
[RECENT CONVERSATION]
${buildRecentConversationBlock()}

[CURRENT CHUNK]
Speaker: ${speaker}
Text: "${chunkText}"

[CONTEXT]
Current Topic: ${meetingState.current_topic}
Current Summary: ${meetingState.conversation_summary}

[CONSTRAINTS]
1. Do not suggest code-level or highly technical replies.
2. Focus on timelines, business value, blockers, or deliverables.
3. Keep it conversational and natural (1-2 sentences).
4. If no response is logically needed, return an empty string.
5. Provide ONLY the suggested text, without quotes or filler.` },
    ];
    return callGroq({ messages, expectJson: false, tag: this.name, ...AGENT_CONFIG[this.name] });
  },
};

module.exports = { responseAgent };
