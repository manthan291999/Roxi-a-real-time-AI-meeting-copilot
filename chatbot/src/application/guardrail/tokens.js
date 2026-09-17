/**
 * guardrail/tokens.js — the exact-match vocabulary the pre-router classifies
 * on. Data only, no logic: this file exists so a wording change (adding a
 * greeting the team actually types) never touches control flow, and a
 * control-flow change never touches wording.
 *
 * WHY EXACT MATCH ONLY — READ BEFORE ADDING A PREFIX/SUBSTRING CHECK:
 *     Real questions from this app's own chat logs that MUST keep reaching
 *     the retrieval graph, not the guardrail:
 *       - "hi what is the ML"
 *       - "hi there can find the meeting about the ML"
 *       - "hi what is the fundamentals of ML"
 *     Every one of these starts with a greeting token. A prefix or substring
 *     match would swallow all three and answer "hi" instead of the actual
 *     question. triage.js normalizes the WHOLE message and checks it against
 *     these sets as one unit — never a token inside a longer message. See
 *     test/triage.test.js's "whole-message rule" cases, which assert exactly
 *     these three strings are NOT intercepted.
 *
 * AFFIRMATIVE_TOKENS / NEGATIVE_TOKENS (added for the `ack` class, phase 4
 * of the pre-router plan): unlike GREETING/HELP, these must NEVER be checked
 * on their own — triage.js only classifies a match as `ack` when
 * guardrail/pendingClarification.js says no clarifying question is pending.
 * The graph has no confirm-before-execute step, so a bare "yes"/"no" is only
 * ever small talk (an acknowledgement with nothing to search for) UNLESS it
 * is the user's actual answer to a clarifying question — see
 * pendingClarification.js's own header comment for the trap this avoids.
 *
 * WHY A SET INSTEAD OF AN LLM CALL:
 *     A `Set.has()` lookup costs a fraction of a millisecond and zero tokens.
 *     Routing "hi" through analyze_query -> retrieve -> grade_documents was
 *     costing 9 API calls and ~16 seconds (see the pre-router plan, §02) to
 *     answer a two-letter greeting. High-frequency, unambiguous input is
 *     exactly what a fixed set is for; anything not in these sets still goes
 *     through the graph and the LLM as before.
 *
 * These sets are exported live (not frozen): Object.freeze on a Set does not
 * actually block .add()/.delete() in V8, since Set mutation does not go
 * through property assignment — freezing here would be theater, not safety.
 * Treat these as read-only by convention; nothing in this codebase mutates
 * them, and test/triage.test.js does not either.
 */

/** Casual English + the Hinglish variants this team's own chat logs contain. */
const GREETING_TOKENS = new Set([
  'hi',
  'hii',
  'hiii',
  'hey',
  'heya',
  'heyy',
  'hello',
  'helloo',
  'yo',
  'sup',
  'hiya',
  'howdy',
  'hi there',
  'hey there',
  'hello there',
  'good morning',
  'good afternoon',
  'good evening',
  'morning',
  'evening',
  'greetings',
  'namaste',
  'namaskar',
  // --- Hinglish ---
  'haan',
  'haanji',
  'han',
  'ji',
  'namaste ji',
  'kaise ho',
  'kya haal hai',
  'sab theek',
]);

/** "What can this thing do" — a fixed, corpus-independent question. */
const HELP_TOKENS = new Set([
  'help',
  'help me',
  'what can you do',
  'who are you',
  'what are you',
  'what is this',
  'what is roxi',
  'how does this work',
  'how do i use this',
  'how to use',
  'what are my options',
  'what can i ask',
  'what can i ask you',
  'commands',
  'guide',
  'instructions',
  'info',
  'about',
  'about you',
]);

/**
 * Bare confirmations. Exact-match only — same whole-message rule as
 * GREETING_TOKENS, for the same reason: "yes, and what did we decide about
 * the release" is a real question, not an acknowledgement.
 */
const AFFIRMATIVE_TOKENS = new Set([
  'yes',
  'yep',
  'yeah',
  'yea',
  'ya',
  'yup',
  'y',
  'ok',
  'okay',
  'k',
  'kk',
  'sure',
  'sure thing',
  'sounds good',
  'sounds great',
  'got it',
  'understood',
  'perfect',
  'great',
  'cool',
  'nice',
  'thanks',
  'thank you',
  'thanks!',
  'ty',
  'cheers',
  'correct',
  'right',
  'that works',
  'works for me',
  'go ahead',
  'do it',
  'proceed',
  // --- Hinglish ---
  'haan',
  'theek hai',
  'thik hai',
  'sahi hai',
  'bilkul',
  'chalega',
]);

/** Bare cancellations. Exact-match only, for the same reason as above. */
const NEGATIVE_TOKENS = new Set([
  'no',
  'nope',
  'nah',
  'n',
  'not really',
  'never mind',
  'nevermind',
  'no thanks',
  'no thank you',
  "that's wrong",
  'incorrect',
  'wrong',
  // --- Hinglish ---
  'nahi',
  'nahin',
  'mat karo',
]);

module.exports = { GREETING_TOKENS, HELP_TOKENS, AFFIRMATIVE_TOKENS, NEGATIVE_TOKENS };
