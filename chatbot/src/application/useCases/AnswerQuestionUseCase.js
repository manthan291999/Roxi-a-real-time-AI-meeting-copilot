/**
 * AnswerQuestionUseCase — the single application entry point the transports
 * (CLI, stdio sidecar, future HTTP) depend on.
 *
 * Responsibilities: input validation, graph invocation with thread-scoped
 * memory, node-progress callbacks, and shaping the final protocol payload.
 */

const { ChatbotError } = require('../../domain/errors');
const { MODES, WEB_MODES } = require('../graph/constants');
const { normalizeWebMode } = require('../graph/webPolicy');
const { resolveMeetingScope } = require('../meetingScope');

class AnswerQuestionUseCase {
  /**
   * @param {{graph: Object,
   *          logger: import('../../domain/ports/ChatLogger').ChatLogger,
   *          defaultWebMode?: 'auto'|'always'|'never'}} deps
   *   defaultWebMode: what a request that does not specify one gets. The
   *   composition root passes config.webSearchMode ('auto' by default) — this
   *   is the single place the product default enters the system. It defaults
   *   to 'never' here so a caller that predates web search (a test, a script,
   *   an older transport) behaves exactly as it did before.
   */
  constructor({ graph, logger, defaultWebMode = WEB_MODES.NEVER, meetingOwners = null }) {
    this.graph = graph;
    this.logger = logger;
    this.defaultWebMode = defaultWebMode;
    /** Resolves an account to the meetings it owns (SqliteMeetingStore). */
    this.meetingOwners = meetingOwners;
  }

  /**
   * @param {Object} input
   * @param {string} input.question   user question (required, non-empty)
   * @param {string} [input.threadId] conversation thread for memory
   * @param {Array<{role:string,content:string}>} [input.history] prior turns (rehydration)
   * @param {string} [input.liveContext] recent lines from the meeting currently being recorded
   * @param {'rag'|'direct'} [input.mode] 'direct' answers from the model alone (no retrieval)
   * @param {'auto'|'always'|'never'} [input.webMode] may this turn reach the
   *   web. Omit to use the configured default; an unrecognised value is off.
   * @param {{kind:string, accountId?:string}} [input.scope] whose past meetings
   *   may be searched; see meetingScope.js. Absent = a host without accounts.
   * @param {(nodeName:string)=>void} [input.onNode] progress callback per node
   * @returns {Promise<{answer:string, sources:Array, clarifyingQuestion:string, followUps:Array, route:string, attempts:number, degradedNote:string, mode:string, webMode:string, usedWebSearch:boolean, webSearchCount:number, guardrail:string}>}
   */
  async run({
    question, threadId = 'default', history = [], liveContext = '',
    mode = MODES.RAG, webMode = undefined, scope = undefined, onNode = null,
  }) {
    if (!question || typeof question !== 'string' || !question.trim()) {
      throw new ChatbotError('Question must be a non-empty string', 'INVALID_INPUT');
    }

    // Normalized here, once, for every transport: the graph is checkpointed
    // per thread and its reducer ignores an absent value, so a turn that left
    // the mode unset would otherwise inherit the previous turn's.
    // Anything but an explicit 'direct' means search.
    const askMode = mode === MODES.DIRECT ? MODES.DIRECT : MODES.RAG;

    // Same normalization, same reason, one extra step: an ABSENT webMode
    // means "use the configured default", which is not the same as an
    // unrecognised one. Absent -> config ('auto' in production); anything
    // unrecognised -> 'never', the cheap, private path.
    const askWebMode = webMode === undefined || webMode === null
      ? normalizeWebMode(this.defaultWebMode)
      : normalizeWebMode(webMode);

    // Resolved per turn, never inherited: the same thread may be continued
    // after a different account signs in.
    const meetingScope = scope && !this.meetingOwners
      ? resolveMeetingScope({ kind: 'nobody' }, null)
      : resolveMeetingScope(scope, this.meetingOwners);

    const config = { configurable: { thread_id: String(threadId) } };
    const started = Date.now();

    // streamMode:'updates' yields {nodeName: partialState} after each node —
    // used for ChatThinking progress events without touching node code.
    const stream = await this.graph.stream(
      {
        question: question.trim(),
        history,
        // Direct mode means no meeting data at all — including the live
        // snapshot the caller attached. Dropped here rather than at the UI
        // because the host and the CLI are senders too.
        liveContext: askMode === MODES.DIRECT ? '' : liveContext,
        mode: askMode,
        webMode: askWebMode,
        meetingScope,
      },
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
      // Echoed so a UI can label the answer with the mode that produced it.
      mode: askMode,
      webMode: askWebMode,
      // Whether the model ACTUALLY searched, counted from the provider's own
      // tool-call items. The difference between this and webMode is the whole
      // measurement behind "is 'auto' tuned right".
      usedWebSearch: Boolean(finalState.usedWebSearch),
      webSearchCount: finalState.webSearchCount || 0,
      // Which guardrail class intercepted this turn ('greeting'|'help'|
      // 'ack'|'gibberish'|'empty'), or '' when it was not intercepted — see
      // state.js's own `guardrail` channel doc comment. Lets a UI skip the
      // "thinking" spinner for an instantly-answered turn without having to
      // infer that from route === 'small_talk' itself.
      guardrail: finalState.guardrail || '',
    };

    this.logger.info('use_case', 'question_answered', {
      threadId: String(threadId),
      mode: askMode,
      webMode: askWebMode,
      usedWebSearch: payload.usedWebSearch,
      webSearchCount: payload.webSearchCount,
      route: payload.route,
      guardrail: payload.guardrail,
      sources: payload.sources.length,
      durationMs: Date.now() - started,
    });

    return payload;
  }
}

module.exports = { AnswerQuestionUseCase };
