const { callGroq } = require('../llm/groq-client.js');
const { validateRisksOutput } = require('../infrastructure/validate.js');
const { meetingState } = require('../state/meeting-state.js');
const { buildMeetingContextBlock, buildRecentConversationBlock } = require('../state/prompt-builder.js');
const { AGENT_CONFIG } = require('../config/agent-config.js');

const riskDetectorAgent = {
  name: 'risk',
  validate: validateRisksOutput,
  async run(chunkText, speaker) {
    const messages = [
      { role: 'system', content: `You are a Senior Risk Analyst at a Big 4 consulting firm.
You identify project risks, timeline threats, resource constraints, scope creep,
and interpersonal disagreements from real-time meeting transcripts.` },
      { role: 'user', content: `[RECENT CONVERSATION]
${buildRecentConversationBlock()}

[CURRENT CHUNK]
Speaker: ${speaker}
Text: "${chunkText}"

[CURRENT TOPIC]: ${meetingState.current_topic}
${buildMeetingContextBlock()}

Identify any risks, blockers, or red flags. Categories:
- TIMELINE: unrealistic deadlines, delayed dependencies
- SCOPE: feature creep, unclear requirements
- RESOURCE: missing expertise, understaffed
- TECHNICAL: architectural debt, security gaps
- ALIGNMENT: disagreements, unclear ownership

Output strictly as JSON:
{
  "risks": [
    { "text": "Risk description", "category": "TIMELINE|SCOPE|RESOURCE|TECHNICAL|ALIGNMENT", "severity": "low|medium|high" }
  ]
}
If no risks detected, return { "risks": [] }.` },
    ];
    return callGroq({ messages, expectJson: true, tag: this.name, ...AGENT_CONFIG[this.name] });
  },
};

module.exports = { riskDetectorAgent };
