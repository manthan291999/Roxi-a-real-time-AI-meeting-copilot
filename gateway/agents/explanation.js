const { callGroq } = require('../llm/groq-client.js');
const { meetingState } = require('../state/meeting-state.js');
const { buildMeetingContextBlock, buildRecentConversationBlock, buildGlossaryBlock } = require('../state/prompt-builder.js');
const { AGENT_CONFIG } = require('../config/agent-config.js');

const explanationAgent = {
  name: 'explanation',
  async run(chunkText, speaker) {
    const messages = [
      { role: 'system', content: `You are an expert AI Meeting Copilot assisting a non-technical stakeholder (e.g., Project Manager, Client, Business Leader) in an IT/Software company.` },
      { role: 'user', content: `[OBJECTIVE]
Translate the latest technical discussion into a plain-language explanation that highlights the business impact, project implications, or timeline risks.
${buildMeetingContextBlock()}
[RECENT CONVERSATION]
${buildRecentConversationBlock()}

[CURRENT CHUNK]
Speaker: ${speaker}
Text: "${chunkText}"

[CONTEXT]
Current Topic: ${meetingState.current_topic}
Known Technical Terms:
${buildGlossaryBlock()}

[CONSTRAINTS]
1. Explain what the engineers are discussing in simple, non-technical terms.
2. Explicitly state the potential business or project implication (e.g., impact on timeline, budget, or deliverables).
3. Keep it brief: 1-3 simple sentences.
4. Output ONLY the explanation. Do not use conversational filler.` },
    ];
    return callGroq({ messages, expectJson: false, tag: this.name, ...AGENT_CONFIG[this.name] });
  },
};

module.exports = { explanationAgent };
