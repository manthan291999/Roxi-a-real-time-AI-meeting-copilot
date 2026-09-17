/**
 * guardrail/replies.js — canned copy for intercepted turns, one place so a
 * wording change is never reviewed alongside a detection threshold (see
 * tokens.js and triage.js, which this file is deliberately kept separate
 * from).
 *
 * Mode-aware: `direct`/`web_direct` consult no corpus (see MODES in
 * graph/constants.js and directAnswerNode's own doc comment), so a reply
 * given in those modes must never suggest meeting-oriented follow-ups —
 * doing so would promise a search that mode does not perform.
 *
 * followUps for the `rag` mode reuse respondNoDataNode's own copy verbatim
 * rather than inventing new phrasing, so the two zero-LLM terminals in this
 * graph (respond_no_data and small_talk) read as one voice.
 */

const { MODES } = require('../graph/constants');

/** Same three follow-ups respondNoDataNode offers — see that file. */
const MEETING_FOLLOW_UPS = [
  'What topics have we discussed in recent meetings?',
  'What open risks or action items do we have?',
  'Summarize the latest meeting',
];

/** No corpus is consulted in direct/web_direct mode — offer nothing that implies one. */
const NO_CORPUS_FOLLOW_UPS = [];

function followUpsForMode(mode) {
  return mode === MODES.RAG ? MEETING_FOLLOW_UPS : NO_CORPUS_FOLLOW_UPS;
}

const HELP_ANSWER =
  'I can search your recorded meetings and any documents you\'ve uploaded, ' +
  'then answer with citations back to where I found it. I can also look ' +
  'things up on the web when that helps. Turn Knowledge off if you\'d ' +
  'rather talk to me directly, without a search.';

const NO_QUESTION_ANSWER =
  'I couldn\'t make out a question there — try naming a topic, person, or meeting.';

/**
 * `ack` never offers follow-ups, in any mode: triage.js only classifies a
 * bare "yes"/"thanks" as `ack` when no clarifying question is pending (see
 * pendingClarification.js), so by definition nothing is currently in
 * flight to suggest continuing — a chip here would read as pushy after a
 * simple "thanks".
 */
const ACK_ANSWER = 'Anything else you\'d like me to look up?';

/**
 * @param {'greeting'|'help'|'ack'|'gibberish'|'empty'} kind
 * @param {string} [mode] one of MODES; anything but 'rag' is treated as
 *   corpus-free (mirrors decideEntry's own "anything but direct means
 *   search" rule, inverted)
 * @returns {{answer: string, followUps: string[]}}
 */
function replyFor(kind, mode) {
  switch (kind) {
    case 'greeting':
      return mode === MODES.RAG
        ? {
          answer: 'Hi - ask me anything about your recorded meetings, or try one of these:',
          followUps: MEETING_FOLLOW_UPS,
        }
        : {
          answer: 'Hi - ask me anything. Knowledge is off, so this won\'t search your meetings.',
          followUps: NO_CORPUS_FOLLOW_UPS,
        };

    case 'help':
      return { answer: HELP_ANSWER, followUps: followUpsForMode(mode) };

    case 'ack':
      return { answer: ACK_ANSWER, followUps: [] };

    // gibberish and empty share copy deliberately (see the pre-router plan,
    // §05): neither is a real question, so neither earns a distinct message.
    case 'gibberish':
    case 'empty':
      return { answer: NO_QUESTION_ANSWER, followUps: followUpsForMode(mode) };

    default:
      // Unreachable from triage.js today; a safe, generic fallback rather
      // than a thrown error if a future kind forgets to add a case here.
      return { answer: NO_QUESTION_ANSWER, followUps: [] };
  }
}

module.exports = { replyFor, MEETING_FOLLOW_UPS };
