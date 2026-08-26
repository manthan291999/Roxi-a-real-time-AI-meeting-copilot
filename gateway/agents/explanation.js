const { callLLM } = require('../llm/openai-client.js');
const { meetingState } = require('../state/meeting-state.js');
const { buildMeetingContextBlock, buildRecentConversationBlock, buildGlossaryBlock } = require('../state/prompt-builder.js');
const { AGENT_CONFIG } = require('../config/agent-config.js');

const explanationAgent = {
  name: 'explanation',
  async run(chunkText, speaker) {
    const messages = [
      { role: 'system', content: `You are a Senior Business Translator operating within an AI Meeting Copilot product
used by non-technical stakeholders (Project Managers, Clients, Business Leaders)
inside enterprise IT and software delivery companies.` },
      { role: 'user', content: `## Objective
Translate the most recent technical discussion into a clear, plain-language
explanation that highlights the business impact, project timeline implications,
or budget risks — so a non-technical stakeholder can immediately understand
what is happening and why it matters.

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
Known Technical Terms:
${buildGlossaryBlock()}

## Rules
- Explain in plain English only — no jargon, no acronyms without definition.
- Always state one explicit business implication (timeline, budget, scope, or risk).
- Maximum 3 sentences. No padding, no filler, no "Great question!".
- Never fabricate information that isn't present in the chunk or recent conversation.
- Do not repeat content from the conversation history verbatim.

## Output Format
Return ONLY the plain-text explanation — no JSON, no markdown headers, no labels.
Maximum 3 sentences. Example length: ~40–80 words.

## Examples
Input chunk: "We're hitting N+1 query issues in the ORM layer, might need to refactor
             to raw SQL or add an eager-loading strategy before we can scale."
Output: "The engineering team found a performance problem that causes the system to make
         too many database requests. This could slow down the product significantly as
         more users join. The fix will require extra refactoring work, which may impact
         the delivery timeline."

Input chunk: "LGTM, let's merge and deploy to staging."
Output: "The team has approved the latest changes and is moving them into the testing
         environment. No blockers were raised — this is a positive sign for the
         current sprint timeline."

## Edge Cases
- If the chunk is purely social/casual (e.g., "sounds good, thanks") → return an empty string "".
- If the chunk references a topic with no business implication → describe what was discussed
  in plain terms without forcing a business framing.
- If context is insufficient (first chunk of a meeting) → explain only what is in the chunk,
  do not assume prior context.

## Safety / Validation
Before outputting, verify:
1. Your explanation does not contradict any fact stated in the chunk.
2. No technical term is used without a plain-language equivalent.
3. The business implication is grounded in the chunk, not invented.` }
    ];
    return callLLM({ messages, expectJson: false, tag: this.name, ...AGENT_CONFIG[this.name] });
  },
};

module.exports = { explanationAgent };
