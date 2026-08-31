/**
 * Node: generate — grounded answer with inline [M#] citations, built ONLY
 * from graded evidence. Degrades to a structured evidence digest when the
 * LLM is unavailable (still useful, still grounded).
 */

const { GENERATE_SYSTEM, formatEvidenceList, formatHistory } = require('../../infrastructure/llm/prompts');
const { toSources } = require('../graph/evidence');
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
              `Meeting evidence:\n${formatEvidenceList(evidence)}\n\n` +
              `Question: ${state.question}`,
          },
        ],
        expectJson: true,
        maxTokens: 1200,
        tag: 'generate',
      });

      if (!data?.answer) throw new Error('generate response missing answer');

      const cited = Array.isArray(data.citedMeetingIds) ? data.citedMeetingIds : [];
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

/** Deterministic grounded digest — no invention, just retrieved quotes. */
function digestFallback(question, evidence) {
  if (evidence.length === 0) return 'I could not find anything relevant in the recorded meetings.';
  const lines = evidence.slice(0, 6).map((h) => {
    const who = h.speaker ? `${h.speaker}: ` : '';
    return `- [M${h.meetingId}] ${who}${h.text}`;
  });
  return `Here is what I found in your meetings about "${question}":\n${lines.join('\n')}`;
}

module.exports = { createGenerateNode };
