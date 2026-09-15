/**
 * Node: generate_web — graded evidence AND a web-search tool.
 *
 * The case neither generate nor web_answer can serve: "how does our design
 * compare with current practice", where the team's own records answer half
 * the question and the web answers the other half. The model gets both and
 * decides whether to search at all — if the evidence already covers the
 * question, the prompt tells it not to, and it costs the same as generate.
 *
 * Also the landing place for the exhausted-retrieval branch: when the
 * rewrite loop finds nothing and the web is enabled, routing sends the turn
 * here with EMPTY evidence rather than to respond_no_data, which turns
 * "nothing in your meetings" into "nothing in your meetings, but here is
 * what the web says". Empty evidence is therefore a normal input, not an
 * error — and it selects a different fallback.
 *
 * Kept separate from generate rather than folded into it: the citation
 * contract genuinely differs (it has to police the boundary between an
 * internal [M3] and an external [W1]), and the node name is what reaches the
 * UI as a ChatThinking event.
 */

const {
  GENERATE_WEB_SYSTEM,
  WEB_MANDATORY_NOTE,
  formatEvidenceList,
  formatHistory,
} = require('../../infrastructure/llm/prompts');
const { splitFollowUps } = require('../../infrastructure/llm/textResponse');
const { HISTORY_TURNS, ROUTES, WEB_MAX_TOKENS } = require('../graph/constants');
const { decideWebTools } = require('../graph/webPolicy');
const { toWebSources, insertWebRefs, readInlineRefs } = require('../graph/webCitations');
const { toSources } = require('../graph/evidence');

/**
 * @param {{web: import('../../domain/ports/WebSearchGateway').WebSearchGateway,
 *          logger: import('../../domain/ports/ChatLogger').ChatLogger,
 *          store?: Object,
 *          fallback?: Function|null,
 *          noDataFallback?: Function|null}} deps
 *   fallback:       the generate node — used when the web fails but evidence exists.
 *   noDataFallback: the respond_no_data node — used when the web fails and
 *                   there was no evidence either, which is the only case
 *                   where there is genuinely nothing to say.
 */
function createGenerateWebNode({ web, logger, store, fallback = null, noDataFallback = null }) {
  return async function generateWeb(state) {
    const policy = decideWebTools(state.webMode);
    const evidence = state.evidence || [];
    const hadEvidence = evidence.length > 0;

    try {
      let systemPrompt = policy.mandatory
        ? `${GENERATE_WEB_SYSTEM}\n\n${WEB_MANDATORY_NOTE}`
        : GENERATE_WEB_SYSTEM;

      // Same role framing generate applies, for the same reason: match the
      // answer's depth to whoever ran the meeting.
      const roleStr = collectRoles(evidence, store);
      if (roleStr) {
        systemPrompt += `\n\nThe person who ran this meeting was acting as: ${roleStr}. Match your answer's depth and framing to that audience.`;
      }

      const userMsg =
        (state.history?.length ? `Prior conversation:\n${formatHistory(state.history, HISTORY_TURNS)}\n\n` : '')
        + (hadEvidence
          ? `Evidence from the team's own records:\n${formatEvidenceList(evidence)}\n\n`
          : "Evidence from the team's own records:\n(none — their meetings and documents had nothing on this)\n\n")
        + `Question: ${state.question}`;

      const res = await web.answer({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg },
        ],
        toolChoice: policy.toolChoice,
        maxTokens: WEB_MAX_TOKENS,
        tag: 'generate_web',
      });

      // Same trailer convention as web_answer: a marker line, not JSON,
      // so the citation offsets in the body above it stay valid.
      const { body, followUps } = splitFollowUps(res && res.answer);
      if (!body) throw new Error('generate_web response missing answer');

      // The plain-text contract means there is no citedRefs field to read.
      // Reading the refs back out of the prose is strictly better anyway: it
      // reports what the model actually cited, not what it claimed to.
      const citedRefs = readInlineRefs(body);
      const internalSources = toSources(evidence, citedRefs.length ? citedRefs : null);
      const webSources = toWebSources(res.citations, body);

      logger.info('generate_web', 'answered', {
        usedWebSearch: res.usedWebSearch,
        searchCalls: res.searchCalls,
        internalCited: internalSources.length,
        webCited: webSources.length,
        hadEvidence,
      });

      return {
        answer: insertWebRefs(body, res.citations),
        // Internal cards first: they are the ones about the user's own work.
        sources: [...internalSources, ...webSources],
        usedWebSearch: Boolean(res.usedWebSearch),
        webSearchCount: res.searchCalls || 0,
        followUps,
        route: ROUTES.GENERATE_WEB,
      };
    } catch (err) {
      logger.warn('generate_web', 'web_call_failed', {
        hadEvidence,
        message: String(err && err.message).slice(0, 160),
      });

      // With evidence in hand, generate still produces a fully grounded
      // answer — real citations, just no web ones. Degrading to it is honest
      // as long as the note says why, so this happens even in 'always' mode:
      // a cited answer from their own records beats a refusal.
      if (hadEvidence && fallback) {
        const out = await fallback(state);
        return {
          ...out,
          usedWebSearch: false,
          webSearchCount: 0,
          degradedNote: joinNotes(out.degradedNote, 'Answered from your meetings only (web search unavailable).'),
        };
      }

      // No evidence and no web: the one case with genuinely nothing to say.
      if (noDataFallback) {
        const out = await noDataFallback(state);
        return {
          ...out,
          usedWebSearch: false,
          webSearchCount: 0,
          degradedNote: joinNotes(out.degradedNote, 'Web search was unavailable for this question.'),
        };
      }

      return {
        answer:
          "I couldn't find anything in your meetings, and I couldn't reach the web "
          + 'to check either. Try again in a moment.',
        sources: [],
        followUps: [],
        route: ROUTES.GENERATE_WEB,
        usedWebSearch: false,
        webSearchCount: 0,
        degradedNote: 'No evidence and web search unavailable.',
      };
    }
  };
}

/** Unique meeting roles behind the cited evidence, as one label. */
function collectRoles(evidence, store) {
  if (!store || !store.getMeetingRole) return '';
  const roles = new Set();
  for (const e of evidence) {
    if (!e.meetingId) continue;
    try {
      const role = store.getMeetingRole(e.meetingId);
      if (role) roles.add(role);
    } catch (_) { /* role framing is a nicety, never a failure */ }
  }
  return [...roles].join(', ');
}

function joinNotes(...notes) {
  return notes.filter((n) => typeof n === 'string' && n.trim()).join(' ');
}

module.exports = { createGenerateWebNode };
