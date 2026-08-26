const { callLLM } = require('../llm/openai-client.js');
const { validateAnalystOutput } = require('../infrastructure/validate.js');
const { meetingState } = require('../state/meeting-state.js');
const { buildMeetingContextBlock, buildRecentConversationBlock } = require('../state/prompt-builder.js');
const { AGENT_CONFIG } = require('../config/agent-config.js');

const meetingAnalystAgent = {
  name: 'analyst',
  validate: validateAnalystOutput,
  async run(chunkText, speaker) {
    const messages = [
      { role: 'system', content: `You are a Meeting Analyst within an enterprise AI copilot. You precisely extract
explicit decisions and action items from live meeting transcripts.` },
      { role: 'user', content: `## Objective
Review the latest transcript chunk in the context of the recent conversation and
extract any concrete decisions made or action items assigned.

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
Current Summary: ${meetingState.conversation_summary}

## Rules
- A decision must be an explicit agreement or commitment made by the participants.
- An action item must be a concrete task.
- If an assignee or deadline is mentioned, extract it. Otherwise use null.
- Do not infer or invent decisions/actions that were not explicitly stated.

## Output Format
Return strictly valid JSON matching this schema exactly:
{
  "new_decisions": [
    { "text": "Decision description", "confidence": 0.9 }
  ],
  "new_action_items": [
    { "text": "Task description", "assignee": "Person Name (or null)", "deadline": "Date/Time (or null)" }
  ]
}

## Edge Cases
- If no decisions or action items are found in the CURRENT CHUNK, return empty arrays.
- Do not re-extract decisions/actions from the conversation history if they were already established prior to the current chunk.

## Safety / Validation
Before outputting, verify:
1. The JSON is perfectly valid.
2. The extracted items originate from the current chunk or its immediate context.` }
    ];
    return callLLM({ messages, expectJson: true, tag: this.name, ...AGENT_CONFIG[this.name] });
  },
};

module.exports = { meetingAnalystAgent };
