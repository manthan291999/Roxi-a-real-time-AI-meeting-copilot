const { createCircuitBreaker, MODES } = require('../infrastructure/circuit-breaker.js');
const { validateChunkInput } = require('../infrastructure/validate.js');
const { log, metrics, textPreview } = require('../infrastructure/logger.js');
const { callLLM } = require('../llm/openai-client.js');

const {
  meetingState,
  setMeetingContext,
  updateFromContextManager,
  addRecentChunk,
  mergeGlossary,
  addRisks,
  addSuggestion,
  hasDuplicateSuggestion
} = require('../state/meeting-state.js');

const { trackSpeaker } = require('../state/speaker-tracker.js');
const { 
  buildMeetingContextBlock, 
  buildRecentConversationBlock, 
  buildSpeakerProfilesBlock, 
  buildGlossaryBlock 
} = require('../state/prompt-builder.js');

const { runAgent } = require('../agents/base-agent.js');
const { AGENT_CONFIG } = require('../config/agent-config.js');
const { contextManagerAgent } = require('../agents/context-manager.js');
const { explanationAgent } = require('../agents/explanation.js');
const { technicalAgent } = require('../agents/technical.js');
const { meetingAnalystAgent } = require('../agents/analyst.js');
const { riskDetectorAgent } = require('../agents/risk-detector.js');
const { responseAgent } = require('../agents/response.js');
const { isChitChat } = require('./chit-chat-gate.js');

const breaker = createCircuitBreaker();

async function generateMeetingSummary() {
  const started = Date.now();
  const messages = [
    { role: 'system', content: `You are a Senior Management Consultant at a Big 4 advisory firm, specializing in
enterprise technology programs. You produce executive-level meeting summaries that
are immediately actionable for C-suite and VP-level stakeholders — clear, structured,
evidence-based, and decision-ready.` },
    { role: 'user', content: `## Objective
Generate a polished, structured meeting summary from the complete conversation
history, extracted artifacts, and detected risks — suitable for distribution to
executive stakeholders who were not in the meeting.

## Input
[MEETING TOPIC]
${meetingState.current_topic}

[MEETING BRIEFING]
${buildMeetingContextBlock()}

[FULL CONVERSATION — last ${meetingState.recent_chunks.length} exchanges]
${buildRecentConversationBlock()}

[SPEAKER PROFILES]
${buildSpeakerProfilesBlock()}

[DETECTED RISKS]
${meetingState.risks.map((r) => `[${(r.severity || 'unknown').toUpperCase()}] ${r.category || 'GENERAL'}: ${r.text}`).join('\n') || 'None identified.'}

[KNOWN TERMINOLOGY]
${buildGlossaryBlock()}

## Rules
- Only include decisions, actions, and risks that are evidenced in the conversation.
- Do not editorialize or add recommendations beyond what was discussed.
- Use plain business English — avoid engineering jargon in the executive section.
- Action items must include the assignee and deadline if they were stated.
- Every section must be present even if empty (use "None identified" for empty sections).

## Output Format
Return as plain text with markdown headings in exactly this structure:

# Meeting Summary

## 1. Meeting Overview
[1-2 sentences: who met, main purpose, outcome]

## 2. Key Discussion Points
- [Bullet per major topic discussed]

## 3. Decisions Made
- [Decision — Owner if stated]
- None identified (if empty)

## 4. Action Items
- [Task — Assignee — Deadline]
- None identified (if empty)

## 5. Risks & Concerns
- [SEVERITY] CATEGORY: Description
- None identified (if empty)

## 6. Recommended Next Steps
- [Concrete next step based on meeting outcomes]

## Edge Cases
- Very short meeting (< 5 chunks) → write a briefer summary, still using all 6 sections.
- No decisions made → state "None identified" in section 3.
- Meeting was exploratory/discussion-only → note that in section 1.

## Safety / Validation
Before outputting, verify:
1. Every decision listed was explicitly agreed upon in the transcript.
2. Every action item has a textual basis — no invented tasks.
3. The overview accurately reflects what the meeting was about.
4. Markdown is well-formed and all 6 sections are present.` },
  ];

  try {
    const { data, latencyMs, attempts } = await callLLM({
      messages,
      expectJson: false,
      timeoutMs: 30000,
      maxTokens: 1024,
      retries: 2,
      tag: 'summary',
    });
    log('info', 'agent', 'summary_ok', { latencyMs, attempts });
    return data || null;
  } catch (err) {
    log('error', 'agent', 'summary_failed', {
      code: err.code || 'unknown',
      message: (err.message || '').slice(0, 200),
      latencyMs: Date.now() - started,
    });
    metrics.increment('summary_failure', { code: err.code || 'unknown' });
    return null;
  }
}

async function analyseChunk(chunkText, speaker = 'Speaker') {
  const output = {
    chunk_significance: 'none',
    current_explanation: null,
    technical_explanation: null,
    decisions: [],
    action_items: [],
    risks: [],
    suggested_response: null,
    current_topic: meetingState.current_topic,
    new_technical_terms: {},
    degraded: false,
    errors: [],
    api_calls_used: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    breaker: breaker.snapshot(),
  };

  const input = validateChunkInput(chunkText, speaker);
  if (!input.ok) {
    output.errors.push({ agent: 'pipeline', code: 'invalid_input', message: input.reason });
    return output;
  }
  const text = input.text;
  const speakerLabel = input.speaker;

  const mode = breaker.beginChunk();
  const calls = { count: 0 };
  const chunkStarted = Date.now();

  try {
    const isFiller = isChitChat(text);
    if (isFiller) {
      log('info', 'agent', 'chit_chat_gate_block', { speaker: speakerLabel, preview: textPreview(text, 40) });
      output.chunk_significance = 'none';
      
      // Still want to track speakers for filler chunks just to know they spoke
      addRecentChunk(speakerLabel, text, 'none');
      trackSpeaker(speakerLabel, text, 'none');
      
      output.breaker = breaker.snapshot();
      output.api_calls_used = calls.count;
      metrics.observe('chunk_latency_ms', Date.now() - chunkStarted, { significance: 'none' });
      return output;
    }

    output.chunk_significance = 'medium'; // Triggers UI rendering

    const cmRes = await runAgent(contextManagerAgent, text, speakerLabel, mode, calls, breaker);
    if (cmRes.usage) {
      output.prompt_tokens += cmRes.usage.prompt_tokens || 0;
      output.completion_tokens += cmRes.usage.completion_tokens || 0;
    }
    let newTerms = {};

    if (cmRes.ok) {
      if (cmRes.data.current_topic) meetingState.current_topic = cmRes.data.current_topic;
      if (cmRes.data.conversation_summary) meetingState.conversation_summary = cmRes.data.conversation_summary;
      newTerms = cmRes.data.new_technical_terms || {};
      if (Object.keys(newTerms).length > 0) mergeGlossary(newTerms);
    } else if (!cmRes.skipped) {
      output.degraded = true;
      output.errors.push(cmRes.error);
    }

    output.current_topic = meetingState.current_topic;
    output.new_technical_terms = newTerms;

    addRecentChunk(speakerLabel, text, 'medium');
    trackSpeaker(speakerLabel, text, 'medium');

    if (mode === MODES.MINIMAL) {
      output.breaker = breaker.snapshot();
      output.api_calls_used = calls.count;
      return output;
    }

    const [explRes, techRes, analystRes, riskRes] = await Promise.all([
      runAgent(explanationAgent, text, speakerLabel, mode, calls, breaker),
      runAgent(technicalAgent, text, speakerLabel, mode, calls, breaker),
      runAgent(meetingAnalystAgent, text, speakerLabel, mode, calls, breaker),
      runAgent(riskDetectorAgent, text, speakerLabel, mode, calls, breaker),
    ]);
    
    // Sanitize function to handle stray quotes and NONE tags
    function sanitizeTextOutput(text) {
      if (typeof text !== 'string') return null;
      let cleaned = text.replace(/^["'=]+|["'=]+$/g, '').trim();
      if (!cleaned || cleaned.toUpperCase() === '[NONE]' || cleaned.toUpperCase() === '[NON_TECHNICAL]') return null;
      return cleaned;
    }

    if (explRes.ok) {
      output.current_explanation = sanitizeTextOutput(explRes.data) || null;
    } else if (!explRes.skipped) {
      output.errors.push(explRes.error);
    }

    if (techRes.ok) {
      output.technical_explanation = sanitizeTextOutput(techRes.data) || null;
    } else if (!techRes.skipped) {
      output.errors.push(techRes.error);
    }
    
    const extraContext = {
      explanation: output.current_explanation,
      technical: output.technical_explanation
    };
    
    const respRes = await runAgent(responseAgent, text, speakerLabel, mode, calls, breaker, extraContext);

    for (const res of [explRes, techRes, analystRes, riskRes, respRes]) {
      if (res.usage) {
        output.prompt_tokens += res.usage.prompt_tokens || 0;
        output.completion_tokens += res.usage.completion_tokens || 0;
      }
    }

    if (analystRes.ok) {
      output.decisions = analystRes.data.new_decisions || analystRes.data.decisions || [];
      output.action_items = analystRes.data.new_action_items || analystRes.data.action_items || [];
    } else if (!analystRes.skipped) {
      output.errors.push(analystRes.error);
    }

    if (riskRes.ok) {
      output.risks = riskRes.data.risks || [];
      if (output.risks.length > 0) {
        addRisks(output.risks);
      }
    } else if (!riskRes.skipped) {
      output.errors.push(riskRes.error);
    }

    if (respRes.ok) {
      const raw = typeof respRes.data === 'string' ? respRes.data.trim() : '';
      if (raw) {
        // Parse the intent tag
        let replyType = 'reply';  // default
        let replyText = sanitizeTextOutput(raw) || '';

        if (replyText.startsWith('[ANSWER]')) {
          replyType = 'answer';
          replyText = replyText.replace('[ANSWER]', '').trim();
        } else if (replyText.startsWith('[QUESTION]')) {
          replyType = 'question';
          replyText = replyText.replace('[QUESTION]', '').trim();
        } else if (replyText.startsWith('[DECISION]')) {
          replyType = 'decision';
          replyText = replyText.replace('[DECISION]', '').trim();
        }

        if (replyText) {
          const isDuplicate = hasDuplicateSuggestion(replyText);
          if (!isDuplicate) {
            addSuggestion(replyText);
            output.suggested_response = replyText;
            output.suggested_response_type = replyType;
          }
        }
      }
    } else if (!respRes.skipped) {
      output.errors.push(respRes.error);
    }
  } catch (err) {
    log('error', 'agent', 'process_chunk_error', { message: (err.message || '').slice(0, 200) });
    output.errors.push({ agent: 'pipeline', code: 'unexpected', message: err.message });
  }

  output.breaker = breaker.snapshot();
  output.api_calls_used = calls.count;
  metrics.observe('chunk_latency_ms', Date.now() - chunkStarted, { significance: output.chunk_significance });
  return output;
}

module.exports = {
  analyseChunk,
  setMeetingContext,
  generateMeetingSummary,
};
