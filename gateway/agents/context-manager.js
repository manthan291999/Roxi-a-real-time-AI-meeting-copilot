const { callLLM } = require('../llm/openai-client.js');
const { validateContextManagerOutput } = require('../infrastructure/validate.js');
const { meetingState } = require('../state/meeting-state.js');
const { buildMeetingContextBlock, buildRecentConversationBlock, buildSpeakerProfilesBlock } = require('../state/prompt-builder.js');
const { AGENT_CONFIG } = require('../config/agent-config.js');

const contextManagerAgent = {
  name: 'context_manager',
  validate: validateContextManagerOutput,
  async run(chunkText, speaker) {
    const messages = [
      { role: 'system', content: `You are the Context Manager for a real-time meeting copilot used by senior
consultants at Big 4 firms. You track conversation flow, detect topic shifts,
and extract new terminology dynamically.` },
      { role: 'user', content: `## Objective
Analyze the latest chunk of conversation, determine if the topic has shifted,
summarize the current state of the discussion, and extract any new technical terms.

## Input
[MEETING BRIEFING]
${buildMeetingContextBlock()}

[CONVERSATION HISTORY — last N turns]
${buildRecentConversationBlock()}

[CURRENT CHUNK BEING ANALYZED]
Speaker: ${speaker}
Text: "${chunkText}"

[SPEAKER PROFILES]
${buildSpeakerProfilesBlock()}

[LIVE CONTEXT]
Current Topic: ${meetingState.current_topic}
Current Summary: ${meetingState.conversation_summary}

## Rules
- Update the "current_topic" ONLY if the conversation has definitively shifted.
- The "conversation_summary" must be 1-2 sentences capturing the overall state.
- Extract new jargon/acronyms into "new_technical_terms" with a plain-English definition.
- Do not hallucinate terms not mentioned in the chunk.

## Output Format
Return strictly valid JSON matching this schema exactly:
{
  "current_topic": "string (the active topic)",
  "conversation_summary": "string (1-2 sentences)",
  "new_technical_terms": {
    "Term": "Plain English definition"
  }
}

## Edge Cases
- If the chunk is trivial chit-chat, leave the topic and summary unchanged.
- If no new terms are found, return an empty object for "new_technical_terms".

## Safety / Validation
Before outputting, verify:
1. The JSON is perfectly valid (no trailing commas).
2. The summary accurately reflects the history + current chunk.
3. No hallucinated terms are included.` }
    ];
    return callLLM({ messages, expectJson: true, tag: this.name, ...AGENT_CONFIG[this.name] });
  },
};

module.exports = { contextManagerAgent };
