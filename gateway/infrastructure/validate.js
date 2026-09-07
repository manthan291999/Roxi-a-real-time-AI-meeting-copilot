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

const MAX_ARTIFACTS = 10; // per-chunk cap on decisions/action items/risks
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

/**
 * Validate/normalize agent artifacts arriving from the Rust ChunkGraph over the
 * control channel. The Rust side has already shaped these, but they cross a
 * process boundary and land in SQLite, so they are re-checked here — the gateway
 * is the sole writer of meeting_history.db and owns that guarantee.
 */
function validateArtifacts(obj) {
  const out = { decisions: [], actionItems: [], risks: [] };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;

  if (Array.isArray(obj.decisions)) {
    for (const d of obj.decisions.slice(0, MAX_ARTIFACTS)) {
      const text = sanitizeText(typeof d === 'string' ? d : d && (d.text || d.description), 1000);
      if (!text) continue;
      const raw = d && d.confidence;
      const confidence = typeof raw === 'number' && Number.isFinite(raw)
        ? Math.min(1, Math.max(0, raw))
        : null;
      out.decisions.push({ text, confidence });
    }
  }

  if (Array.isArray(obj.actionItems)) {
    for (const a of obj.actionItems.slice(0, MAX_ARTIFACTS)) {
      const text = sanitizeText(typeof a === 'string' ? a : a && (a.text || a.description), 1000);
      if (!text) continue;
      out.actionItems.push({
        text,
        assignee: sanitizeText(a && a.assignee, 200),
        deadline: sanitizeText(a && a.deadline, 200),
      });
    }
  }

  if (Array.isArray(obj.risks)) {
    for (const r of obj.risks.slice(0, MAX_ARTIFACTS)) {
      const text = sanitizeText(typeof r === 'string' ? r : r && r.text, 1000);
      if (!text) continue;
      out.risks.push({
        text,
        category: RISK_CATEGORIES.includes(r && r.category) ? r.category : null,
        severity: RISK_SEVERITIES.includes(r && r.severity) ? r.severity : null,
      });
    }
  }

  return out;
}

/** Validate the chunk envelope that carries those artifacts. */
function validateChunkEnvelope(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, reason: 'not_an_object' };
  const text = sanitizeText(obj.text, MAX_TEXT_LEN);
  if (!text) return { ok: false, reason: 'empty_or_invalid_chunk' };
  return {
    ok: true,
    text,
    speaker: sanitizeText(obj.speaker, 100) || 'Speaker',
    significance: SIGNIFICANCE_VALUES.includes(obj.significance) ? obj.significance : null,
    topic: sanitizeText(obj.topic, 200),
  };
}

module.exports = {
  MAX_TEXT_LEN,
  SIGNIFICANCE_VALUES,
  sanitizeText,
  validateTranscriptEvent,
  validateArtifacts,
  validateChunkEnvelope,
};
