/**
 * AnswerQuestionUseCase — the single application entry point the transports
 * (CLI, stdio sidecar, future HTTP) depend on.
 *
 * Responsibilities: input validation, graph invocation with thread-scoped
 * memory, node-progress callbacks, and shaping the final protocol payload.
 */

const { ChatbotError } = require('../../domain/errors');

class AnswerQuestionUseCase {
  /**
   * @param {{graph: Object, logger: import('../../domain/ports/ChatLogger').ChatLogger}} deps
   */
  constructor({ graph, logger }) {
    this.graph = graph;
    this.logger = logger;
  }

  /**
   * @param {Object} input
   * @param {string} input.question   user question (required, non-empty)
   * @param {string} [input.threadId] conversation thread for memory
   * @param {Array<{role:string,content:string}>} [input.history] prior turns (rehydration)
   * @param {string} [input.liveContext] recent lines from the meeting currently being recorded
   * @param {(nodeName:string)=>void} [input.onNode] progress callback per node
   * @returns {Promise<{answer:string, sources:Array, clarifyingQuestion:string, followUps:Array, route:string, attempts:number, degradedNote:string}>}
   */
  async run({ question, threadId = 'default', history = [], liveContext = '', onNode = null }) {
    if (!question || typeof question !== 'string' || !question.trim()) {
      throw new ChatbotError('Question must be a non-empty string', 'INVALID_INPUT');
    }

    const config = { configurable: { thread_id: String(threadId) } };
    const started = Date.now();

    // streamMode:'updates' yields {nodeName: partialState} after each node —
    // used for ChatThinking progress events without touching node code.
    const stream = await this.graph.stream(
      { question: question.trim(), history, liveContext },
      { ...config, streamMode: 'updates' }
    );

    let finalState = {};
    for await (const update of stream) {
      for (const [nodeName, partial] of Object.entries(update)) {
        finalState = { ...finalState, ...(partial || {}) };
        if (onNode) {
          try { onNode(nodeName); } catch (_) { /* progress is best-effort */ }
        }
      }
    }

    const payload = {
      answer: finalState.answer || '',
      sources: finalState.sources || [],
      clarifyingQuestion: finalState.clarifyingQuestion || '',
      followUps: finalState.followUps || [],
      route: finalState.route || 'generate',
      attempts: (finalState.attempt || 0) + 1,
      degradedNote: finalState.degradedNote || '',
    };

    this.logger.info('use_case', 'question_answered', {
      threadId: String(threadId),
      route: payload.route,
      sources: payload.sources.length,
      durationMs: Date.now() - started,
    });

    return payload;
  }
}

module.exports = { AnswerQuestionUseCase };
