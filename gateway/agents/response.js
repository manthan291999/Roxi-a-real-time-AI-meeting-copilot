const { callLLM } = require('../llm/openai-client.js');
const { meetingState } = require('../state/meeting-state.js');
const { buildMeetingContextBlock, buildRecentConversationBlock, buildUserProfileBlock } = require('../state/prompt-builder.js');
const { AGENT_CONFIG } = require('../config/agent-config.js');

const responseAgent = {
  name: 'response',
  async run(chunkText, speaker, extraContext = {}) {
    const messages = [
      { role: 'system', content: `You are an AI Meeting Copilot response coach.
Your job is to help meeting participants formulate confident, contextually accurate,
and professionally appropriate spoken responses during live meetings.
Adapt your language depth and vocabulary to the user's role and expertise level.
${meetingState.user_profile.technical_depth === 'high'
  ? 'The user is technically proficient — use precise language and technical accuracy.'
  : 'The user is non-technical — use plain business language without jargon.'}` },
      { role: 'user', content: `## Objective
Generate one natural, business-focused spoken reply or clarifying question that
the stakeholder can say immediately in response to the technical discussion —
helping them stay engaged, demonstrate understanding, and keep the meeting
productive.

## Input
[MEETING BRIEFING]
${buildMeetingContextBlock()}

${buildUserProfileBlock()}

[CONVERSATION HISTORY — last N turns]
${buildRecentConversationBlock()}

[CURRENT CHUNK BEING ANALYZED]
Speaker: ${speaker}
Text: "${chunkText}"

[LIVE CONTEXT]
Current Topic: ${meetingState.current_topic}
Current Summary: ${meetingState.conversation_summary}

[LIVE ANALYSIS OF THIS CHUNK]
Executive Summary: ${extraContext.explanation || 'None'}
Technical Analysis: ${extraContext.technical || 'None'}

## Rules
- Write in first-person spoken English — it must sound natural when said aloud.
- Focus on: timelines, deliverables, blockers, business value, ownership, next steps.
- Calibrate technical depth to match the user profile injected below.
- For expert/high-depth users: technical precision is preferred.
- For non-technical users: plain business language only.
- Maximum 2 sentences. Conversational tone. No formal report language.
- If no response is genuinely needed (acknowledgment-only context), return exactly: ""
- Never fabricate project details, names, or deadlines not present in the conversation.

## Output Format
You MUST start your response with exactly one of these tags:
[ANSWER] - when you are providing the answer to a question
[QUESTION] - when you are suggesting a follow-up question to ask
[DECISION] - when confirming a decision and suggesting next steps

After the tag, write the response text.
If no response is needed, return exactly: ""

Example outputs:
[ANSWER] LangChain is a framework for sequential LLM pipelines...
[QUESTION] Can you explain the trade-offs between latency and accuracy here?
[DECISION] Sounds good — should we document this and assign an owner?



## Edge Cases
- Pure casual conversation → return ""
- If a decision was just made → suggest a confirmation or next-step reply.
- If a risk was raised → suggest a stakeholder-appropriate clarifying question.
- If speaker is currently presenting data → do not interrupt; return ""

## Safety / Validation
Before outputting, verify:
1. The reply does not contain technical jargon the stakeholder would not naturally say.
2. The reply is grounded in the actual chunk — no invented context.
3. It does not repeat verbatim what was just said in the conversation.` }
    ];
    return callLLM({ messages, expectJson: false, tag: this.name, ...AGENT_CONFIG[this.name] });
  },
};

module.exports = { responseAgent };
