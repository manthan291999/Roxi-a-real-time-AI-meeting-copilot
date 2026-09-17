/**
 * guardrail/gibberish.js — is this message unintelligible: not a real
 * question, not real content, just noise?
 *
 * THREE GATES, ALL must agree per token before a token counts as gibberish
 * (pre-router plan §06 has the full worked argument against a dictionary
 * check). The meeting archive this app searches is MADE OF proper nouns,
 * acronyms, product names and snake_case identifiers — "ML", "Nisha",
 * "krishaweb", "Tauri" are all real questions this app has actually
 * answered correctly (see tokens.js's own header comment for the logged
 * evidence). A dictionary-based detector is structurally wrong for this
 * corpus, which is why none of the three gates below consults one:
 *
 *   1. LENGTH  — a token this short is ALWAYS exempt: acronyms and short
 *                names never reach the shape gate at all.
 *   2. SHAPE   — character statistics only: a very low vowel ratio, a long
 *                run of consonants, or very few distinct characters.
 *   3. CORPUS  — if the token appears anywhere in the user's own meetings
 *                or documents, it is meaningful here by definition,
 *                whatever its shape says. The probe is a PARAMETER here,
 *                never an import — this file must not reach for a database
 *                (see the pre-router plan §07's invariant on the guardrail/
 *                folder, and CorpusProbe.js's own doc comment on why the
 *                probe fails open rather than throwing).
 *
 * The asymmetry that shapes every threshold below: a false positive here —
 * telling a user their real question is nonsense — is unrecoverable; a
 * false negative costs one wasted turn that falls through to the graph as
 * normal. Every gate is written to lean toward the false negative.
 *
 * MESSAGE-LEVEL RULE, in two parts — this is the part that took three
 * iterations to get right, and is worth reading in full before touching it:
 *
 *   1. ANY EVIDENCE OF ORDINARY LANGUAGE STOPS THE WHOLE MESSAGE, even a
 *      short token's shape counts. "what did we say about
 *      hbvxvsjhvbcjhvjbcx" must fall through — the user may be quoting a
 *      real string from a log — and every one of what/did/we/say/about has
 *      an ordinary vowel ratio; that alone is enough to call the sentence
 *      real without ever reaching the one strange token. This check
 *      ignores the length exemption on purpose: the exemption exists so a
 *      short token is never independently ACCUSED (protecting real
 *      acronyms like "ML"/"RRF"), but a short token can still testify FOR
 *      the message — "what" is exactly as short as "hbvx" and the shape
 *      gate can tell them apart fine; length only matters for the verdict
 *      against a token, never for the evidence in its favour.
 *
 *   2. OTHERWISE, at least one token must be long enough to judge AND every
 *      such token must fail all three gates. "hbvxvsjhvbcjhvjbcx jbh cbh"
 *      is gibberish: none of its three tokens has an ordinary shape (not
 *      even the two short ones — "jbh"/"cbh" have zero vowels, same as the
 *      long one), so part 1 does not save it, and the one token long
 *      enough to formally judge fails every gate. "jbh cbh" ALONE — two
 *      short, odd-shaped tokens and nothing else — stays undecided and
 *      falls through: nothing in it is long enough to convict, which is
 *      the conservative side of the same asymmetry above.
 *
 * An earlier version of part 2 alone (requiring only every LONG token to
 * fail) let "hbvxvsjhvbcjhvjbcx jbh cbh" — the phrase that motivated this
 * feature — slip through, purely because "jbh"/"cbh" are short enough to
 * be exempt from being judged at all. Part 1 exists to fix that without
 * reopening the length exemption's whole purpose: it uses a short token's
 * shape as evidence, never as an accusation.
 *
 * The message must also be short overall (MAX_TOKENS_FOR_GIBBERISH_CHECK) —
 * a long message that happens to contain one strange token is not remotely
 * the same signal as a short message that is nothing but noise.
 */

/** Tokens this long or shorter are always exempt — see the header comment. */
const LENGTH_EXEMPT_MAX_CHARS = 5;

/** A message longer than this many tokens is never classified as gibberish. */
const MAX_TOKENS_FOR_GIBBERISH_CHECK = 6;

const VOWELS = new Set('aeiou');
/** Below this vowel ratio, a token's shape is suspicious. */
const MIN_VOWEL_RATIO = 0.20;
/** A run of consonants this long or longer is suspicious. */
const MAX_CONSONANT_RUN = 5;
/** Below this ratio of distinct characters to length, a token is suspicious. */
const MIN_DISTINCT_RATIO = 0.30;

/**
 * Splits raw text into lowercased word tokens with punctuation stripped from
 * each token's own edges — NOT the same job as guardrail/normalize.js,
 * which produces one canonical key for a whole message for exact-match set
 * lookups. Gibberish detection instead needs each individual WORD cleaned
 * (a mid-sentence "hbvxvsjhvbcjhvjbcx," must not keep its trailing comma
 * when its shape is measured), so this is a separate, local tokenizer
 * rather than a reuse of normalize()'s edge-only trimming.
 *
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
    .filter(Boolean);
}

function vowelRatio(token) {
  let vowels = 0;
  for (const ch of token) if (VOWELS.has(ch)) vowels += 1;
  return vowels / token.length;
}

function longestConsonantRun(token) {
  let longest = 0;
  let current = 0;
  for (const ch of token) {
    if (/[a-z]/.test(ch) && !VOWELS.has(ch)) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

function distinctRatio(token) {
  return new Set(token).size / token.length;
}

/**
 * The shape gate alone — character statistics, no dictionary, no corpus.
 * @param {string} token already lowercased
 * @returns {boolean} true when the shape looks suspicious. Still needs the
 *   corpus gate to actually classify as gibberish — see isGibberishToken.
 */
function looksSuspicious(token) {
  return vowelRatio(token) < MIN_VOWEL_RATIO
    || longestConsonantRun(token) >= MAX_CONSONANT_RUN
    || distinctRatio(token) < MIN_DISTINCT_RATIO;
}

/**
 * All three gates for one token.
 * @param {string} token already lowercased, edge-punctuation stripped
 * @param {import('../../domain/ports/CorpusProbe')|{has:(t:string)=>boolean}|null|undefined} [probe]
 *   Absent/null (nothing wired to call this at all) is treated as a probe
 *   that always finds the term — gibberish detection is then fully inert,
 *   the same conservative default this codebase already uses for a missing
 *   optional axis elsewhere (see decideWebTools treating an absent webMode
 *   as off, not as auto). This is DELIBERATELY the same direction
 *   PermissiveCorpusProbe takes, so the two are observationally identical
 *   (see that class's own comment) — but it is NOT the same case as a real
 *   probe backed by a genuinely empty index (the "cold start" in this
 *   file's header comment): THAT correctly returns false per term (an
 *   honest "not found", no failure occurred), which lets the shape gate's
 *   verdict stand rather than being overridden. Only a missing/null probe
 *   OBJECT short-circuits to "always found"; a present probe that
 *   legitimately finds nothing does not.
 * @returns {boolean}
 */
function isGibberishToken(token, probe) {
  if (token.length <= LENGTH_EXEMPT_MAX_CHARS) return false;
  if (!looksSuspicious(token)) return false;
  const found = probe && typeof probe.has === 'function' ? probe.has(token) : true;
  return !found;
}

/**
 * @param {string} text raw, un-normalized message
 * @param {import('../../domain/ports/CorpusProbe')|{has:(t:string)=>boolean}|null} [probe]
 * @returns {boolean} see the header comment's MESSAGE-LEVEL RULE
 */
function isGibberishMessage(text, probe) {
  const tokens = tokenize(text);
  if (tokens.length === 0) return false; // the 'empty' class handles this, not gibberish
  if (tokens.length > MAX_TOKENS_FOR_GIBBERISH_CHECK) return false;

  // Part 1: any token's shape looking like ordinary language — regardless
  // of length — is evidence the message is real, and stops the check here.
  if (tokens.some((t) => !looksSuspicious(t))) return false;

  // Part 2: nothing in the message looked real. Now require at least one
  // token long enough to actually convict, and every such token to fail
  // all three gates.
  const judgeable = tokens.filter((t) => t.length > LENGTH_EXEMPT_MAX_CHARS);
  if (judgeable.length === 0) return false;
  return judgeable.every((t) => isGibberishToken(t, probe));
}

module.exports = { isGibberishMessage, isGibberishToken };
