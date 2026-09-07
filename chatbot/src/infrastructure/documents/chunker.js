/**
 * chunker — splits a parsed document into overlapping, embeddable passages.
 *
 * Pure and dependency-free, so it is unit-testable and needs no tokenizer.
 * Sizes are in CHARACTERS: at roughly 4 chars per token, 2,000 chars is about
 * 500 tokens, comfortably inside text-embedding-3-small's window while still
 * carrying enough context to answer from.
 *
 * Boundaries are chosen by preference, not by fixed rule:
 *   1. a paragraph break   — the cleanest semantic seam
 *   2. a sentence end      — next best
 *   3. a hard cut          — for text with neither (tables, minified prose)
 * Only the tail of the window is searched, so a boundary is never taken so
 * early that the chunk becomes tiny.
 *
 * Overlap exists so a fact spanning a boundary is retrievable from at least
 * one chunk in full.
 */

'use strict';

const DEFAULT_MAX_CHARS = 2000;
const DEFAULT_OVERLAP_CHARS = 256;

/**
 * Overlap is capped at this fraction of the window so every step advances by
 * at least (1 - MAX_OVERLAP_RATIO) of it. Without the cap, an overlap close to
 * maxChars advances a character at a time and the chunk count explodes — it
 * still terminates, but a 2,400-char document yielded 1,604 chunks, each of
 * which would be separately embedded and billed.
 */
const MAX_OVERLAP_RATIO = 0.5;

/** Fraction of the window, measured from its end, in which to seek a break. */
const BOUNDARY_SEARCH_WINDOW = 0.35;

const PARAGRAPH_BREAK = /\n\s*\n/g;
const SENTENCE_END = /[.!?]["')\]]?\s/g;

/**
 * Last index of `pattern` within text[from, to), or -1.
 * Returns the offset just AFTER the match, which is where the next chunk
 * should begin.
 */
function lastBreakIn(text, pattern, from, to) {
  pattern.lastIndex = 0;
  let found = -1;
  let m;
  const slice = text.slice(from, to);
  while ((m = pattern.exec(slice)) !== null) {
    found = from + m.index + m[0].length;
    if (m.index === pattern.lastIndex) pattern.lastIndex += 1; // zero-length guard
  }
  return found;
}

/**
 * Flatten pages into one string, remembering where each page starts so a
 * chunk can report the page it begins on.
 *
 * @param {import('../../domain/ports/DocumentParser').ParsedPage[]} pages
 */
function flattenPages(pages) {
  let text = '';
  const spans = [];
  for (const page of pages) {
    const pageText = typeof page.text === 'string' ? page.text : '';
    if (!pageText) continue;
    const start = text.length;
    text += pageText;
    spans.push({ pageNumber: page.pageNumber ?? null, start, end: text.length });
    // Separator doubles as a paragraph break, so page ends are preferred seams.
    text += '\n\n';
  }
  return { text, spans };
}

/** The page a given document offset falls in, or null. */
function pageAt(spans, offset) {
  for (const span of spans) {
    if (offset >= span.start && offset < span.end) return span.pageNumber;
  }
  return spans.length ? spans[spans.length - 1].pageNumber : null;
}

/**
 * @param {import('../../domain/ports/DocumentParser').ParsedDocument} parsed
 * @param {{maxChars?: number, overlapChars?: number}} [opts]
 * @returns {Array<{chunkIndex:number, pageNumber:number|null, charStart:number, charEnd:number, text:string}>}
 */
function chunkDocument(parsed, opts = {}) {
  const maxChars = opts.maxChars || DEFAULT_MAX_CHARS;
  const requestedOverlap =
    opts.overlapChars == null ? DEFAULT_OVERLAP_CHARS : opts.overlapChars;
  const overlapChars = Math.max(
    0,
    Math.min(requestedOverlap, Math.floor(maxChars * MAX_OVERLAP_RATIO)),
  );

  const pages = Array.isArray(parsed && parsed.pages) ? parsed.pages : [];
  const { text, spans } = flattenPages(pages);
  if (!text.trim()) return [];

  const chunks = [];
  let cursor = 0;

  while (cursor < text.length) {
    const hardEnd = Math.min(cursor + maxChars, text.length);
    let end = hardEnd;

    if (hardEnd < text.length) {
      // Only look for a seam in the tail, so the chunk stays a useful size.
      const searchFrom = cursor + Math.floor(maxChars * (1 - BOUNDARY_SEARCH_WINDOW));
      const paragraph = lastBreakIn(text, PARAGRAPH_BREAK, searchFrom, hardEnd);
      const sentence =
        paragraph === -1 ? lastBreakIn(text, SENTENCE_END, searchFrom, hardEnd) : -1;
      if (paragraph > cursor) end = paragraph;
      else if (sentence > cursor) end = sentence;
      // else: no seam at all — fall through to the hard cut.
    }

    const body = text.slice(cursor, end);
    if (body.trim()) {
      chunks.push({
        chunkIndex: chunks.length,
        pageNumber: pageAt(spans, cursor),
        charStart: cursor,
        charEnd: end,
        text: body.trim(),
      });
    }

    if (end >= text.length) break;

    // Step forward with overlap. overlapChars is capped at half the window, so
    // this always advances by at least maxChars/2; the guard is belt-and-braces
    // for a seam found unusually early.
    const next = end - overlapChars;
    cursor = next > cursor ? next : end;
  }

  return chunks;
}

module.exports = {
  chunkDocument,
  DEFAULT_MAX_CHARS,
  DEFAULT_OVERLAP_CHARS,
  MAX_OVERLAP_RATIO,
};
