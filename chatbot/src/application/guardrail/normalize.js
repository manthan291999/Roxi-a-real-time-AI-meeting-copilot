/**
 * guardrail/normalize.js — string -> canonical lookup key.
 *
 * PURE: same input always produces the same output, no I/O, no clock.
 *
 * Why this is its own file: "  HI!!!  ", "Hi." and "hi" must all produce the
 * identical key, or the exact-match sets in tokens.js leak like a sieve —
 * every one of them would need its own punctuated/cased variant enumerated
 * by hand. One normalizer, tested independently, means tokens.js only ever
 * has to list the canonical form.
 *
 * Pipeline (in this order — each step assumes the previous one already ran):
 *   1. NFKC                       fullwidth/compatibility forms -> standard
 *   2. lowercase
 *   3. strip emoji & zero-width   decorative noise around a real greeting
 *   4. collapse internal whitespace
 *   5. trim leading/trailing punctuation (. , ! ? … ~ -)
 *   6. trim
 */

/** Emoji / pictographic characters, stripped rather than treated as content. */
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/** Zero-width and BOM characters that survive copy-paste invisibly. */
const ZERO_WIDTH_RE = /[​-‍﻿⁠]/g;

/** Punctuation trimmed only from the message's edges, never mid-string. */
const EDGE_PUNCTUATION_RE = /^[.,!?…~-]+|[.,!?…~-]+$/g;

/**
 * @param {unknown} input
 * @returns {string} canonical lookup key; '' for anything with no content
 *   left after normalization (emoji-only, punctuation-only, non-string).
 */
function normalize(input) {
  if (typeof input !== 'string') return '';

  let s = input.normalize('NFKC').toLowerCase();
  s = s.replace(EMOJI_RE, '');
  s = s.replace(ZERO_WIDTH_RE, '');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(EDGE_PUNCTUATION_RE, '');
  return s.trim();
}

module.exports = { normalize };
