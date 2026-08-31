/**
 * Node: grade_documents — LLM relevance gate (anti-hallucination).
 * Keeps only evidence genuinely related to the question; degrades to
 * score-ordered top hits when the LLM is unavailable.
 */

const { GRADE_SYSTEM } = require('../../infrastructure/llm/prompts');
const { boundEvidence } = require('../graph/evidence');

const CANDIDATE_SNIPPET_CHARS = 300;

/**
 * @param {{llm: import('../../domain/ports/LlmGateway').LlmGateway, logger: import('../../domain/ports/ChatLogger').ChatLogger}} deps
 */
function createGradeDocumentsNode({ llm, logger }) {
  return async function gradeDocuments(state) {
    const hits = state.hits || [];
    if (hits.length === 0) return { evidence: [] };

    const candidates = hits
      .map((h, i) => {
        const who = h.speaker ? ` (${h.speaker})` : '';
        return `[${i}] Meeting #${h.meetingId} · ${h.sourceTable}${who}: ${String(h.text).slice(0, CANDIDATE_SNIPPET_CHARS)}`;
      })
      .join('\n');

    try {
      const { data } = await llm.complete({
        messages: [
          { role: 'system', content: GRADE_SYSTEM },
          {
            role: 'user',
            content: `Question: ${state.question}\n\nCandidates:\n${candidates}`,
          },
        ],
        expectJson: true,
        maxTokens: 300,
        tag: 'grade_documents',
      });

      const idx = Array.isArray(data?.relevantIndices) ? data.relevantIndices : null;
      if (idx === null) throw new Error('unparseable grading response');

      const relevant = idx
        .filter((i) => Number.isInteger(i) && i >= 0 && i < hits.length)
        .map((i) => hits[i]);

      logger.info('grade_documents', 'graded', { candidates: hits.length, relevant: relevant.length });
      return { evidence: boundEvidence(relevant) };
    } catch (err) {
      logger.warn('grade_documents', 'llm_failed_degrading', { message: String(err.message).slice(0, 160) });
      return {
        evidence: boundEvidence(hits),
        degradedNote: 'Relevance grading skipped (kept top-ranked hits).',
      };
    }
  };
}

module.exports = { createGradeDocumentsNode };
