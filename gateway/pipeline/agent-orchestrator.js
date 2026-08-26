const { createCircuitBreaker, MODES } = require('../infrastructure/circuit-breaker.js');
const { validateChunkInput } = require('../infrastructure/validate.js');
const { log, metrics, textPreview } = require('../infrastructure/logger.js');
const { callGroq } = require('../llm/groq-client.js');

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
    { role: 'system', content: `You are a Senior Consultant at McKinsey & Company.
Generate a polished, executive-level meeting summary suitable for sharing with
C-suite stakeholders. Be concise, structured, and action-oriented.` },
    { role: 'user', content: `Generate a comprehensive meeting summary.

[MEETING TOPIC]: ${meetingState.current_topic}
${buildMeetingContextBlock()}

[FULL CONVERSATION HISTORY — last ${meetingState.recent_chunks.length} exchanges]:
${buildRecentConversationBlock()}

[SPEAKER PROFILES]:
${buildSpeakerProfilesBlock()}

[KNOWN TERMS]:
${buildGlossaryBlock()}

[DETECTED RISKS]:
${meetingState.risks.map((r) => `[${(r.severity || 'unknown').toUpperCase()}] ${r.category || 'GENERAL'}: ${r.text}`).join('\n') || 'None detected.'}

Generate a summary with these sections:
1. Meeting Overview (1-2 sentences)
2. Key Discussion Points (bullet points)
3. Decisions Made (bullet points, with who decided if known)
4. Action Items (with assignees and deadlines if mentioned)
5. Risks & Concerns (if any)
6. Recommended Next Steps

Output as plain text with markdown headings.` },
  ];

  try {
    const { data, latencyMs, attempts } = await callGroq({
      messages,
      expectJson: false,
      timeoutMs: 30000,
      retries: 2,
      model: AGENT_CONFIG.analyst.model,
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

    const [explRes, techRes, analystRes, riskRes, respRes] = await Promise.all([
      runAgent(explanationAgent, text, speakerLabel, mode, calls, breaker),
      runAgent(technicalAgent, text, speakerLabel, mode, calls, breaker),
      runAgent(meetingAnalystAgent, text, speakerLabel, mode, calls, breaker),
      runAgent(riskDetectorAgent, text, speakerLabel, mode, calls, breaker),
      runAgent(responseAgent, text, speakerLabel, mode, calls, breaker),
    ]);

    if (explRes.ok) {
      output.current_explanation = explRes.data || null;
    } else if (!explRes.skipped) {
      output.errors.push(explRes.error);
    }

    if (techRes.ok) {
      const techText = typeof techRes.data === 'string' ? techRes.data.trim() : '';
      output.technical_explanation = techText && techText !== '[NON_TECHNICAL]' ? techText : null;
    } else if (!techRes.skipped) {
      output.errors.push(techRes.error);
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
      const reply = typeof respRes.data === 'string' ? respRes.data : '';
      if (reply.trim()) {
        const isDuplicate = hasDuplicateSuggestion(reply);
        if (!isDuplicate) {
          addSuggestion(reply);
          output.suggested_response = reply;
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
