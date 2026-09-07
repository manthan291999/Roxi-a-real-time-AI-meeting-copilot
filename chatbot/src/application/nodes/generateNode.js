/**
 * Node: generate — grounded answer with inline [M#]/[D#] citations, built ONLY
 * from graded evidence. Degrades to a structured evidence digest when the
 * LLM is unavailable (still useful, still grounded).
 */

const { GENERATE_SYSTEM, formatEvidenceList, formatHistory } = require('../../infrastructure/llm/prompts');
const { toSources, sourceTypeOf } = require('../graph/evidence');
const { HISTORY_TURNS, ROUTES } = require('../graph/constants');

/**
 * @param {{llm: import('../../domain/ports/LlmGateway').LlmGateway, logger: import('../../domain/ports/ChatLogger').ChatLogger}} deps
 */
function createGenerateNode({ llm, logger }) {
  return async function generate(state) {
    const evidence = state.evidence || [];

    try {
      const { data } = await llm.complete({
        messages: [
          { role: 'system', content: GENERATE_SYSTEM },
          {
            role: 'user',
            content:
              (state.history?.length ? `Prior conversation:\n${formatHistory(state.history, HISTORY_TURNS)}\n\n` : '') +
              `Evidence:\n${formatEvidenceList(evidence)}\n\n` +
              `Question: ${state.question}`,
          },
        ],
        expectJson: true,
        maxTokens: 1200,
        tag: 'generate',
      });

      if (!data?.answer) throw new Error('generate response missing answer');

      const cited = readCitedRefs(data);
      const sources = toSources(evidence, cited.length ? cited : null);

      return {
        answer: String(data.answer).trim(),
        sources,
        followUps: Array.isArray(data.followUps)
          ? data.followUps.filter((f) => typeof f === 'string' && f.trim()).slice(0, 3)
          : [],
        route: ROUTES.GENERATE,
      };
    } catch (err) {
      logger.warn('generate', 'llm_failed_degrading', { message: String(err.message).slice(0, 160) });
      return {
        answer: digestFallback(state.question, evidence),
        sources: toSources(evidence),
        followUps: [],
        route: ROUTES.GENERATE,
        degradedNote: 'Answer assembled directly from evidence (LLM unavailable).',
      };
    }
  };
}

/**
 * Read the citations off a generate response.
 *
 * Accepts the legacy `citedMeetingIds` shape as well as the current
 * `citedRefs`: a request already in flight when this shipped, or a model that
 * has latched onto the old prompt, still resolves its sources instead of
 * silently returning an answer with no cards under it.
 *
 * @returns {string[]} refs, e.g. ['M3', 'D2']
 */
function readCitedRefs(data) {
  if (Array.isArray(data.citedRefs)) {
    return data.citedRefs
      .filter((r) => typeof r === 'string' && r.trim())
      .map((r) => r.trim());
  }
  if (Array.isArray(data.citedMeetingIds)) {
    return data.citedMeetingIds
      .filter((id) => id !== null && id !== undefined && String(id).trim() !== '')
      .map((id) => `M${id}`);
  }
  return [];
}

/** Deterministic grounded digest — no invention, just retrieved quotes. */
function digestFallback(question, evidence) {
  if (evidence.length === 0) return 'I could not find anything relevant in the recorded meetings.';
  const lines = evidence.slice(0, 6).map((h) => {
    if (sourceTypeOf(h) === 'document') {
      const page = h.pageNumber ? ` p${h.pageNumber}` : '';
      return `- [${h.ref || 'D?'} ${h.fileName || 'document'}${page}] ${h.text}`;
    }
    const who = h.speaker ? `${h.speaker}: ` : '';
    return `- [${h.ref || `M${h.meetingId}`}] ${who}${h.text}`;
  });
  const where = evidence.some((h) => sourceTypeOf(h) === 'document')
    ? 'your meetings and documents'
    : 'your meetings';
  return `Here is what I found in ${where} about "${question}":\n${lines.join('\n')}`;
}

module.exports = { createGenerateNode };
