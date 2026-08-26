/**
 * AI Meeting Interpreter — Input Validation & Sanitization
 *
 * Applied at every trust boundary: STT transcript events, semantic-buffer
 * flushes, LLM JSON outputs, and all DB writes. Nothing user- or model-
 * generated reaches meetingState or SQLite unvalidated.
 */

const MAX_TEXT_LEN = 10000;

// Strip C0 control chars except \t \n \r (keep markdown/newlines intact).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const SIGNIFICANCE_VALUES = ['none', 'low', 'medium', 'high'];
const RISK_CATEGORIES = ['TIMELINE', 'SCOPE', 'RESOURCE', 'TECHNICAL', 'ALIGNMENT'];
const RISK_SEVERITIES = ['low', 'medium', 'high'];

/**
 * Sanitize an untrusted string: type-check, drop control characters, trim,
 * cap length. Returns null when nothing usable remains.
 */
function sanitizeText(value, maxLen = MAX_TEXT_LEN) {
  if (typeof value !== 'string') return null;
  const s = value.replace(CONTROL_CHARS, '').trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/** Validate a transcript event coming from an STT provider. */
function validateTranscriptEvent(evt) {
  const text = sanitizeText(evt && evt.text, 5000);
  if (!text) return { ok: false, reason: 'empty_or_invalid_text' };
  const speaker = sanitizeText(evt && evt.speaker, 100) || 'Speaker';
  return { ok: true, text, speaker, confidence: evt.confidence };
}

/** Validate a chunk about to enter the agent pipeline. */
function validateChunkInput(chunkText, speaker) {
  const text = sanitizeText(chunkText, MAX_TEXT_LEN);
  if (!text) return { ok: false, reason: 'empty_or_invalid_chunk' };
  return { ok: true, text, speaker: sanitizeText(speaker, 100) || 'Speaker' };
}

/** Validate/normalize the Context Manager's JSON output. Never returns null. */
function validateContextManagerOutput(obj) {
  const out = {
    chunk_significance: 'none',
    current_topic: null,
    conversation_summary: null,
    new_technical_terms: {},
  };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  if (SIGNIFICANCE_VALUES.includes(obj.chunk_significance)) {
    out.chunk_significance = obj.chunk_significance;
  }
  out.current_topic = sanitizeText(obj.current_topic, 200);
  out.conversation_summary = sanitizeText(obj.conversation_summary, 1000);
  if (obj.new_technical_terms && typeof obj.new_technical_terms === 'object' && !Array.isArray(obj.new_technical_terms)) {
    for (const [k, v] of Object.entries(obj.new_technical_terms)) {
      const term = sanitizeText(k, 100);
      const def = sanitizeText(v, 500);
      if (term && def) out.new_technical_terms[term] = def;
    }
  }
  return out;
}

/** Validate/normalize the Meeting Analyst's JSON output. */
function validateAnalystOutput(obj) {
  const out = { decisions: [], action_items: [] };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;

  if (Array.isArray(obj.new_decisions)) {
    for (const d of obj.new_decisions.slice(0, 10)) {
      const text = sanitizeText(d && (d.text || d.description), 1000);
      if (!text) continue;
      const confidence = typeof d.confidence === 'number' && Number.isFinite(d.confidence)
        ? Math.min(1, Math.max(0, d.confidence))
        : null;
      out.decisions.push({ text, confidence });
    }
  }

  if (Array.isArray(obj.new_action_items)) {
    for (const a of obj.new_action_items.slice(0, 10)) {
      const text = sanitizeText(a && (a.text || a.description), 1000);
      if (!text) continue;
      out.action_items.push({
        text,
        assignee: sanitizeText(a && a.assignee, 200),
        deadline: sanitizeText(a && a.deadline, 200),
      });
    }
  }

  return out;
}

/** Validate/normalize the Risk Detector's JSON output. */
function validateRisksOutput(obj) {
  const out = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !Array.isArray(obj.risks)) return out;
  for (const r of obj.risks.slice(0, 10)) {
    const text = sanitizeText(r && r.text, 1000);
    if (!text) continue;
    out.push({
      text,
      category: RISK_CATEGORIES.includes(r && r.category) ? r.category : null,
      severity: RISK_SEVERITIES.includes(r && r.severity) ? r.severity : null,
    });
  }
  return out;
}

module.exports = {
  MAX_TEXT_LEN,
  sanitizeText,
  validateTranscriptEvent,
  validateChunkInput,
  validateContextManagerOutput,
  validateAnalystOutput,
  validateRisksOutput,
};
