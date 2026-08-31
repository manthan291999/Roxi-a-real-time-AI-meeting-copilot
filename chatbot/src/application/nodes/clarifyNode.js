/**
 * Node: clarify — asked when the question is under-specified. Shows what was
 * found in the meetings, then asks ONE clarifying question with concrete
 * options (exactly the "show meeting details, then ask what exactly" flow).
 */

const { CLARIFY_SYSTEM, formatEvidenceList, formatHistory } = require('../../infrastructure/llm/prompts');
const { toSources } = require('../graph/evidence');
const { HISTORY_TURNS, ROUTES } = require('../graph/constants');

/**
 * @param {{llm: import('../../domain/ports/LlmGateway').LlmGateway, logger: import('../../domain/ports/ChatLogger').ChatLogger}} deps
 */
function createClarifyNode({ llm, logger }) {
  return async function clarify(state) {
    const evidence = state.evidence || [];
    const sources = toSources(evidence);
    const meetingCount = new Set(evidence.map((e) => e.meetingId)).size;

    try {
      const { data } = await llm.complete({
        messages: [
          { role: 'system', content: CLARIFY_SYSTEM },
          {
            role: 'user',
            content:
              `User question: ${state.question}\n` +
              (state.ambiguityNote ? `What seems unclear: ${state.ambiguityNote}\n` : '') +
              (state.history?.length ? `Prior conversation:\n${formatHistory(state.history, HISTORY_TURNS)}\n` : '') +
              `\nEvidence found in meetings:\n${formatEvidenceList(evidence) || '(none)'}`,
          },
        ],
        expectJson: true,
        maxTokens: 500,
        tag: 'clarify',
      });

      if (!data?.clarifyingQuestion) throw new Error('clarify response missing clarifyingQuestion');

      return {
        answer: typeof data.summaryOfWhatWasFound === 'string' && data.summaryOfWhatWasFound.trim()
          ? data.summaryOfWhatWasFound.trim()
          : `I found related discussion in ${meetingCount} meeting(s).`,
        clarifyingQuestion: String(data.clarifyingQuestion).trim(),
        followUps: Array.isArray(data.options)
          ? data.options.filter((o) => typeof o === 'string' && o.trim()).slice(0, 3)
          : [],
        sources,
        route: ROUTES.CLARIFY,
      };
    } catch (err) {
      logger.warn('clarify', 'llm_failed_degrading', { message: String(err.message).slice(0, 160) });
      return {
        answer: `I found related discussion in ${meetingCount} meeting(s).`,
        clarifyingQuestion: 'What exactly would you like to know about this topic?',
        followUps: [],
        sources,
        route: ROUTES.CLARIFY,
        degradedNote: 'Clarifying question generated without the LLM.',
      };
    }
  };
}

module.exports = { createClarifyNode };
