/**
 * ftsQuery — pure helpers turning natural language into SAFE FTS5 MATCH
 * expressions. The LLM never writes FTS syntax directly (injection/syntax
 * error guard); it only supplies keywords, which we sanitize here.
 *
 * FTS5 match grammar notes: a bare word is a term; double-quoted strings are
 * phrases; AND/OR/NOT are operators. We strip everything else.
 */

/** Remove FTS5 operators/specials from a single token. */
function sanitizeToken(token) {
  return String(token)
    .replace(/["'`()*:^{}[\]\\]/g, ' ')   // specials that break MATCH
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, ' ') // operators as words
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split text into searchable tokens (len >= 2, no pure punctuation). */
function tokenize(text) {
  return sanitizeToken(text)
    .split(/\s+/)
    .map((t) => t.replace(/[.,;:!?]+$/g, ''))
    .filter((t) => t.length >= 2);
}

/** Escape a phrase for FTS5 by doubling embedded quotes. */
function quotePhrase(phrase) {
  return '"' + String(phrase).replace(/"/g, '""') + '"';
}

/**
 * Build ranked MATCH expressions from keywords.
 * Returns up to 3 expressions, best-precision first:
 *   1. AND of all keywords (precise)
 *   2. quoted bigram phrases (if any adjacent keyword pairs look like terms)
 *   3. OR of all keywords (broad recall)
 * Empty array when nothing searchable remains.
 *
 * @param {string[]} keywords
 * @returns {string[]}
 */
function buildMatchExpressions(keywords) {
  const tokens = [];
  for (const k of keywords || []) {
    const clean = sanitizeToken(k);
    if (!clean) continue;
    // Multi-word keyword -> phrase; single word -> term.
    if (clean.includes(' ')) tokens.push({ phrase: clean });
    else tokens.push({ term: clean });
  }
  if (tokens.length === 0) return [];

  const exprs = [];

  const andParts = tokens.map((t) => (t.phrase ? quotePhrase(t.phrase) : t.term));
  if (andParts.length > 1) exprs.push(andParts.join(' AND '));
  else exprs.push(andParts[0]);

  const orParts = [...new Set(tokens.map((t) => (t.phrase ? quotePhrase(t.phrase) : t.term)))];
  if (orParts.length > 1) exprs.push(orParts.join(' OR '));

  return [...new Set(exprs)];
}

/** Deterministic keyword fallback when the LLM analyze step fails. */
const STOPWORDS = new Set(
  ('a an the is are was were be been being do does did have has had will would can could should of in on at to for from with about into over after before and or not no yes i you he she it we they me him her us them my your his its our their what which who whom whose when where why how this that these those there here please tell find show me did we did you regarding related issue problem bug error').split(' ')
);

/** @param {string} question @returns {string[]} naive keywords */
function keywordsFromQuestion(question) {
  return tokenize(question)
    .filter((t) => !STOPWORDS.has(t.toLowerCase()))
    .slice(0, 8);
}

module.exports = { sanitizeToken, tokenize, quotePhrase, buildMatchExpressions, keywordsFromQuestion };
