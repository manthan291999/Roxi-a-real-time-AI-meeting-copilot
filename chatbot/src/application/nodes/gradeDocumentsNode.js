/**
 * Node: grade_documents — LLM relevance gate (anti-hallucination).
 * Keeps only evidence genuinely related to the question; degrades to
 * score-ordered top hits when the LLM is unavailable.
 */

const { GRADE_SYSTEM } = require('../../infrastructure/llm/prompts');
const { boundEvidence, sourceTypeOf } = require('../graph/evidence');

const CANDIDATE_SNIPPET_CHARS = 300;

/**
 * Human-readable provenance for one grading candidate.
 *
 * Deliberately NOT the citation ref: refs are assigned by boundEvidence, which
 * runs after grading, so at this point there is nothing to print. It does not
 * matter — the grader answers with relevantIndices, so the label only has to
 * tell the model what kind of thing it is looking at.
 */
function describeCandidate(hit) {
  if (sourceTypeOf(hit) === 'document') {
    const page = hit.pageNumber ? ` · page ${hit.pageNumber}` : '';
    return `${hit.fileName || 'document'}${page}`;
  }
  const who = hit.speaker ? ` (${hit.speaker})` : '';
  return `Meeting #${hit.meetingId} · ${hit.sourceTable}${who}`;
}

/**
 * @param {{llm: import('../../domain/ports/LlmGateway').LlmGateway, logger: import('../../domain/ports/ChatLogger').ChatLogger}} deps
 */
function createGradeDocumentsNode({ llm, logger }) {
  return async function gradeDocuments(state) {
    const hits = state.hits || [];
    if (hits.length === 0) return { evidence: [] };

    const candidates = hits
      .map((h, i) => `[${i}] ${describeCandidate(h)}: ${String(h.text).slice(0, CANDIDATE_SNIPPET_CHARS)}`)
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
