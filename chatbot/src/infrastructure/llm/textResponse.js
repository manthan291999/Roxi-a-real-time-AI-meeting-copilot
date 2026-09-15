/**
 * textResponse — parsing conventions for PLAIN-TEXT model replies.
 *
 * The sibling of json-parse.js, for the one path that cannot ask for JSON.
 * The web-search path returns prose because URL citations arrive as character
 * offsets into the reply: wrap that reply in a JSON envelope and every offset
 * addresses the serialised JSON instead of the words, so the [W#] tokens land
 * inside string literals.
 *
 * That left nowhere to put the follow-up questions the UI renders as chips
 * under every answer. A trailing marker line is the answer: it survives in
 * prose, it is trivially separable, and because it sits at the very END,
 * removing it cannot disturb any citation offset in the body above it.
 */

/** The trailer the web prompts ask for. Tolerant of FOLLOWUPS / FOLLOW-UPS. */
const FOLLOWUPS_LINE = /^\s*FOLLOW-?UPS\s*:\s*(.*)$/i;

/**
 * Split a plain-text reply into its body and its follow-up questions.
 *
 * The marker is honoured ONLY on the last non-empty line. A model that
 * mentions the word mid-answer, or writes an example inside a code block, has
 * not written a trailer — and treating it as one would truncate the answer.
 *
 * @param {string} text raw reply
 * @param {number} [max] cap, matching the UI's chip row
 * @returns {{body: string, followUps: string[]}}
 */
function splitFollowUps(text, max = 3) {
  const raw = typeof text === 'string' ? text : '';
  if (!raw) return { body: '', followUps: [] };

  const lines = raw.split('\n');
  let i = lines.length - 1;
  while (i >= 0 && !lines[i].trim()) i -= 1;
  if (i < 0) return { body: raw, followUps: [] };

  const match = lines[i].match(FOLLOWUPS_LINE);
  if (!match) return { body: raw, followUps: [] };

  const followUps = match[1]
    .split('|')
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, max);

  // The body keeps everything above the marker. An answer that was ONLY a
  // trailer is degenerate, and the caller's own empty check will catch it.
  return { body: lines.slice(0, i).join('\n').trimEnd(), followUps };
}

module.exports = { splitFollowUps };
