/**
 * Node: web_answer — the Knowledge switch off, the Web switch on.
 *
 * No corpus at all (no FTS, no documents, no vector memory, no live
 * transcript) but the model is handed a web-search tool and decides for
 * itself whether the question needs it. One call either way: a question it
 * can answer directly costs exactly what direct_answer costs.
 *
 * Depends on the WebSearchGateway port only, so the provider behind it stays
 * swappable — same contract discipline as every other node in this folder.
 *
 * It must never return a source it did not retrieve. An answer with no cards
 * here means "the model answered from its own knowledge", which is true and
 * is what the UI says.
 */

const { WEB_DIRECT_SYSTEM, WEB_MANDATORY_NOTE, toChatTurns } = require('../../infrastructure/llm/prompts');
const { splitFollowUps } = require('../../infrastructure/llm/textResponse');
const { DIRECT_HISTORY_TURNS, ROUTES, WEB_MAX_TOKENS } = require('../graph/constants');
const { decideWebTools } = require('../graph/webPolicy');
const { toWebSources, insertWebRefs } = require('../graph/webCitations');

/**
 * @param {{web: import('../../domain/ports/WebSearchGateway').WebSearchGateway,
 *          logger: import('../../domain/ports/ChatLogger').ChatLogger,
 *          fallback?: Function|null}} deps
 *   fallback: a node with the same signature to delegate to when the web is
 *   unreachable — the composition root passes the already-built
 *   direct_answer node. Injected rather than imported so this node never
 *   learns what it is falling back to, and so the graph needs no extra edge.
 */
function createWebAnswerNode({ web, logger, fallback = null }) {
  return async function webAnswer(state) {
    const policy = decideWebTools(state.webMode);

    try {
      const res = await web.answer({
        messages: [
          {
            role: 'system',
            content: policy.mandatory
              ? `${WEB_DIRECT_SYSTEM}\n\n${WEB_MANDATORY_NOTE}`
              : WEB_DIRECT_SYSTEM,
          },
          ...toChatTurns(state.history, DIRECT_HISTORY_TURNS),
          { role: 'user', content: state.question },
        ],
        toolChoice: policy.toolChoice,
        maxTokens: WEB_MAX_TOKENS,
        tag: 'web_answer',
      });

      // The follow-up chips ride a trailing marker line rather than a JSON
      // field, because this path cannot ask for JSON without invalidating
      // every citation offset. Split BEFORE anything reads the text.
      const { body, followUps } = splitFollowUps(res && res.answer);
      if (!body) throw new Error('web response empty');

      logger.info('web_answer', 'answered', {
        usedWebSearch: res.usedWebSearch,
        searchCalls: res.searchCalls,
        citations: (res.citations || []).length,
      });

      return {
        answer: insertWebRefs(body, res.citations),
        sources: toWebSources(res.citations, body),
        usedWebSearch: Boolean(res.usedWebSearch),
        webSearchCount: res.searchCalls || 0,
        followUps,
        route: ROUTES.WEB,
      };
    } catch (err) {
      logger.warn('web_answer', 'web_call_failed', {
        mandatory: policy.mandatory,
        message: String(err && err.message).slice(0, 160),
      });

      // 'auto' asked for the best answer available, so the model alone is a
      // legitimate degradation — it carries no sources, which is honest.
      if (fallback && !policy.mandatory) {
        const out = await fallback(state);
        return {
          ...out,
          usedWebSearch: false,
          webSearchCount: 0,
          degradedNote: joinNotes(out.degradedNote, 'Answered without the web (search unavailable).'),
        };
      }

      // 'always' asked specifically for web-sourced facts. Quietly returning
      // an unsourced answer there would misrepresent where it came from.
      return {
        answer:
          "I couldn't reach the web to check that, so I can't give you a sourced "
          + 'answer right now. Try again in a moment.',
        sources: [],
        followUps: [],
        route: ROUTES.WEB,
        usedWebSearch: false,
        webSearchCount: 0,
        degradedNote: 'Web search unavailable.',
      };
    }
  };
}

function joinNotes(...notes) {
  return notes.filter((n) => typeof n === 'string' && n.trim()).join(' ');
}

module.exports = { createWebAnswerNode };
