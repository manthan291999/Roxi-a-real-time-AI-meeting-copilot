const { callLLM } = require('../llm/openai-client.js');
const { validateRisksOutput } = require('../infrastructure/validate.js');
const { meetingState } = require('../state/meeting-state.js');
const { buildMeetingContextBlock, buildRecentConversationBlock } = require('../state/prompt-builder.js');
const { AGENT_CONFIG } = require('../config/agent-config.js');

const riskDetectorAgent = {
  name: 'risk',
  validate: validateRisksOutput,
  async run(chunkText, speaker) {
    const messages = [
      { role: 'system', content: `You are a Senior Risk Analyst at a Big 4 consulting firm, integrated into an AI
Meeting Copilot. You identify project risks, timeline threats, resource constraints,
scope creep, and interpersonal disagreements.` },
      { role: 'user', content: `## Objective
Analyze the current chunk of conversation and identify any risks, blockers,
or red flags that threaten the project's success.

## Input
[MEETING BRIEFING]
${buildMeetingContextBlock()}

[CONVERSATION HISTORY — last N turns]
${buildRecentConversationBlock()}

[CURRENT CHUNK BEING ANALYZED]
Speaker: ${speaker}
Text: "${chunkText}"

[LIVE CONTEXT]
Current Topic: ${meetingState.current_topic}

## Rules
- Only extract risks that are explicitly discussed or heavily implied in the text.
- Classify the risk into one of: TIMELINE, SCOPE, RESOURCE, TECHNICAL, ALIGNMENT.
- Assign a severity: low, medium, or high.
- Do not hallucinate risks.

## Output Format
Return strictly valid JSON matching this schema exactly:
{
  "risks": [
    {
      "text": "Brief description of the risk",
      "category": "TIMELINE|SCOPE|RESOURCE|TECHNICAL|ALIGNMENT",
      "severity": "low|medium|high"
    }
  ]
}

## Edge Cases
- If no risks are detected, return an empty array for "risks".

## Safety / Validation
Before outputting, verify:
1. The JSON is perfectly valid.
2. The risk is grounded in the current chunk and context.` }
    ];
    return callLLM({ messages, expectJson: true, tag: this.name, ...AGENT_CONFIG[this.name] });
  },
};

module.exports = { riskDetectorAgent };
