/**
 * Node: respond_no_data — deterministic terminal for "nothing found after all
 * retrieval attempts". No LLM call (zero cost), honest message, and pointers
 * to what the user can try next.
 *
 * Special case: when the question was flagged ambiguous, this node becomes a
 * clarification terminal — it offers recent meeting topics as concrete options
 * ("show what's available, then ask what exactly they want").
 */

const { ROUTES } = require('../graph/constants');

/**
 * @param {{logger?: import('../../domain/ports/ChatLogger').ChatLogger, retriever?: import('../../domain/ports/Retriever').Retriever}} deps
 */
function createRespondNoDataNode({ logger = null, retriever = null } = {}) {
  return async function respondNoData(state) {
    logger?.info('respond_no_data', 'no_evidence', {
      attempts: (state.attempt || 0) + 1,
      ambiguous: Boolean(state.isAmbiguous),
      question: String(state.question).slice(0, 120),
    });

    // Ambiguous question + no match -> offer recent topics, ask what exactly.
    if (state.isAmbiguous && retriever) {
      const topics = retriever.recentTopics(3);
      if (topics.length > 0) {
        const topicLines = topics
          .map((t) => `- Meeting #${t.meetingId} (${t.meetingDate || 'date n/a'}): ${t.topic}`)
          .join('\n');
        return {
          answer:
            `Your question is quite broad, and I couldn't match it to specific meeting content.\n\n` +
            `Here are the most recent recorded meetings:\n${topicLines}`,
          sources: topics.map((t) => ({
            meetingId: t.meetingId,
            date: t.meetingDate,
            speaker: '',
            snippet: t.topic,
            sourceTable: 'summaries',
          })),
          clarifyingQuestion: 'Which of these would you like to know more about — or can you name the topic, person, or feature you mean?',
          followUps: topics.map((t) => `Summarize meeting #${t.meetingId}`),
          route: ROUTES.CLARIFY,
        };
      }
    }

    return {
      answer:
        `I couldn't find "${state.question}" in any recorded meeting.\n\n` +
        'This can happen when:\n' +
        '- the topic was discussed before recording started, or in a meeting that was not captured\n' +
        '- different words were used in the meeting\n\n' +
        'Try rephrasing with names, feature names, or error messages you remember.',
      sources: [],
      clarifyingQuestion: '',
      followUps: [
        'What topics have we discussed in recent meetings?',
        'What open risks or action items do we have?',
        'Summarize the latest meeting',
      ],
      route: ROUTES.NO_DATA,
    };
  };
}

module.exports = { createRespondNoDataNode };
