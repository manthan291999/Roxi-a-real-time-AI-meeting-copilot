const { callGroq } = require('../llm/groq-client.js');
const { meetingState } = require('../state/meeting-state.js');
const { buildMeetingContextBlock, buildRecentConversationBlock, buildGlossaryBlock } = require('../state/prompt-builder.js');
const { AGENT_CONFIG } = require('../config/agent-config.js');

const technicalAgent = {
  name: 'technical',
  async run(chunkText, speaker) {
    const messages = [
      { role: 'system', content: `You are a Senior Systems Architect and Technical Lead at an IT/Software company.` },
      { role: 'user', content: `[OBJECTIVE]
Analyze the latest technical discussion and provide a deep-dive technical assessment, highlighting architectural implications, system design patterns, or technical risks.
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
1. Explain the technical concepts assuming your audience consists of other software engineers.
2. Highlight potential technical risks (e.g., race conditions, scalability bottlenecks, security flaws) or design pattern implications.
3. Keep it brief: 1-3 concise technical sentences.
4. Output ONLY the technical explanation. Do not use conversational filler.
5. CRITICAL: If the input chunk does not contain any engineering or technical discussion (e.g., casual conversation, business-only talk, non-engineering topics), you MUST return EXACTLY the string "[NON_TECHNICAL]". Do not output anything else.` },
    ];
    return callGroq({ messages, expectJson: false, tag: this.name, ...AGENT_CONFIG[this.name] });
  },
};

module.exports = { technicalAgent };
