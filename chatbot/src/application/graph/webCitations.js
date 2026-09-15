/**
 * webCitations — pure helpers turning provider URL citations into the same
 * citation model the rest of the stack already speaks.
 *
 * Kept dependency-free beside evidence.js, for the same reason: the ref
 * assignment and the offset arithmetic are exactly the parts worth proving
 * with plain objects.
 *
 * Citation model: a web source is a GROUP of one (a URL), and it gets a REF
 * of 'W<n>' — scoped to a single answer, like evidence.js's 'D2'. 'W1' means
 * "the first web source in this answer" and means nothing outside it.
 *
 * WHAT THE OFFSETS ACTUALLY POINT AT — verified against the live API, not
 * assumed: the provider writes its own inline markdown link into the prose
 * ("v24.21.0 ([nodejs.org](https://nodejs.org/...))") and the annotation span
 * covers THAT LINK, not the sentence it supports. Two consequences drive the
 * code below:
 *   - such a span is REPLACED by the [W#] token rather than followed by it,
 *     because leaving it in prints a 60-character URL mid-sentence in a
 *     renderer that does not parse markdown, and appending a token beside it
 *     cites the same source twice;
 *   - the card's snippet comes from the text BEFORE the span, since the span
 *     itself is link markup and says nothing a reader wants.
 * A span that is ordinary prose (a provider that annotates the sentence
 * instead) is handled the other way: token appended, span kept, snippet taken
 * from the span. Both shapes are covered because neither is guaranteed.
 *
 * Why web citations do NOT go through boundEvidence(): nothing retrieved
 * them. They are produced by the model's own tool call during generation,
 * after the evidence pipeline has finished, so they have no score, no rank
 * and no group to be bounded against.
 */

const { WEB_MAX_CITATIONS } = require('./constants');

/** Refs the internal corpora use — everything except the web's own 'W'. */
const INTERNAL_REF = /\[([A-VX-Z])(\d+)\]/g;

/**
 * A span whose entire content is a markdown link, optionally wrapped in
 * parentheses and optionally trailed by punctuation — i.e. an artefact the
 * provider inserted, carrying no prose of its own. Anchored at both ends on
 * purpose: a span that contains a link AND words is prose, and replacing it
 * would delete the answer's own content.
 */
const PROVIDER_LINK_SPAN = /^[\s(]*\[[^\]]*\]\([^)\s]*\)[\s).,;:]*$/;

/**
 * De-duplicate citations by URL and assign each surviving one its ref.
 *
 * One shared pass so that toWebSources() and insertWebRefs() cannot disagree
 * about which URL is W2 — an inline [W2] that pointed at a different card
 * than the one underneath would be worse than no citation at all.
 *
 * @param {import('../../domain/ports/WebSearchGateway').WebCitation[]} citations
 * @param {number} max
 * @returns {Map<string, {ref: string, citation: Object}>} url -> assignment
 */
function assignRefs(citations, max = WEB_MAX_CITATIONS) {
  const byUrl = new Map();
  if (!Array.isArray(citations)) return byUrl;

  for (const c of citations) {
    if (!c || typeof c.url !== 'string' || !c.url.trim()) continue;
    const url = c.url.trim();
    if (byUrl.has(url)) continue;
    if (byUrl.size >= max) break;
    byUrl.set(url, { ref: `W${byUrl.size + 1}`, citation: c });
  }
  return byUrl;
}

/**
 * Map citations to the protocol's source-card shape.
 *
 * `text` is the answer the citations address; when supplied, each card gets
 * the passage it actually supports as its snippet, which is what makes a web
 * card as useful as a meeting card instead of a bare link.
 *
 * @param {import('../../domain/ports/WebSearchGateway').WebCitation[]} citations
 * @param {string} [text] the answer, for snippet extraction
 * @param {number} [max]
 * @returns {Array<Object>}
 */
function toWebSources(citations, text = '', max = WEB_MAX_CITATIONS) {
  const assigned = assignRefs(citations, max);
  const body = typeof text === 'string' ? text : '';

  return [...assigned.entries()].map(([url, { ref, citation }]) => {
    const start = clampIndex(citation.startIndex, body.length);
    const end = clampIndex(citation.endIndex, body.length);
    const span = end > start ? body.slice(start, end) : '';
    // A link span says nothing; the passage in front of it is the claim the
    // source is actually backing.
    const snippet = PROVIDER_LINK_SPAN.test(span)
      ? precedingPassage(body, start)
      : stripLightMarkdown(span);
    return {
      ref,
      sourceType: 'web',
      title: String(citation.title || '').trim(),
      url,
      snippet,
      // Parallel to a meeting hit's 'transcripts' or a document's
      // 'documents': what kind of thing this row came out of.
      sourceTable: 'web',
    };
  });
}

/**
 * Put the [W#] tokens into the answer where the provider's citations are.
 *
 * This is what makes a web answer look like every other answer rather than a
 * special case: the provider hands back prose plus character ranges, and the
 * rest of the stack — the inline-citation renderer, the source cards, the
 * user's own reading habit — already understands bracket tokens.
 *
 * A span that is purely the provider's own markdown link is REPLACED by the
 * token; a span that carries prose keeps its text and gets the token after
 * it. See the module comment for why both cases exist.
 *
 * Walks the edits BACK TO FRONT. Front-to-back would shift every remaining
 * offset by the length difference of what was just written, which silently
 * drops later tokens into the middle of words.
 *
 * @param {string} text
 * @param {import('../../domain/ports/WebSearchGateway').WebCitation[]} citations
 * @param {number} [max]
 * @returns {string}
 */
function insertWebRefs(text, citations, max = WEB_MAX_CITATIONS) {
  const body = typeof text === 'string' ? text : '';
  if (!body || !Array.isArray(citations) || citations.length === 0) return body;

  const assigned = assignRefs(citations, max);
  if (assigned.size === 0) return body;

  // One insertion per (position, ref) pair. A provider that reports the same
  // source twice for one sentence must not produce "[W1] [W1]".
  const seen = new Set();
  const edits = [];
  for (const c of citations) {
    if (!c || typeof c.url !== 'string') continue;
    const entry = assigned.get(c.url.trim());
    if (!entry) continue; // dropped by the cap
    const end = clampIndex(c.endIndex, body.length);
    const start = Math.min(clampIndex(c.startIndex, body.length), end);
    const key = `${start}:${end}:${entry.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const isLink = end > start && PROVIDER_LINK_SPAN.test(body.slice(start, end));
    edits.push({ start: isLink ? start : end, end, ref: entry.ref, replace: isLink });
  }

  // Descending by where the edit starts; for a tie, descending by ref so the
  // finished text reads "[W1] [W2]" rather than "[W2] [W1]".
  edits.sort((a, b) => (b.start - a.start) || compareRefs(b.ref, a.ref));

  let out = body;
  for (const { start, end, ref, replace } of edits) {
    const token = `[${ref}]`;
    if (replace) {
      out = `${out.slice(0, start)}${token}${out.slice(end)}`;
      continue;
    }
    // Already cited there by the model itself — leave it alone.
    if (out.slice(start, start + token.length + 1).includes(token)) continue;
    out = `${out.slice(0, start)} ${token}${out.slice(start)}`;
  }
  return out;
}

/**
 * The passage a citation is backing: the last line of the text in front of
 * it, which is the unit a reader recognises in a bulleted or paragraphed
 * answer. Trimmed from the END when long, because the words nearest the
 * citation are the ones it supports.
 */
function precedingPassage(text, start, max = 180) {
  const head = text.slice(0, start).replace(/[\s(]+$/, '');
  if (!head) return '';
  const line = head.slice(head.lastIndexOf('\n') + 1).trim();
  const clean = stripLightMarkdown(line || head);
  return clean.length > max ? `…${clean.slice(-max).trimStart()}` : clean;
}

/**
 * Drop the light markdown the prompts ask for, for display in a card that
 * renders plain text. Cosmetic only — the answer itself is left alone.
 */
function stripLightMarkdown(s) {
  return String(s)
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^[-*]\s+/, '')
    .trim();
}

/**
 * Read the internal refs the model cited in prose: [M3], [D2], [L1], [G1].
 *
 * Replaces generate's JSON `citedRefs` field on the web path, where the
 * response has to be plain text (see OpenAiResponsesGateway). This is
 * arguably the better signal anyway: it reports what the model actually
 * wrote in the answer, not what it claimed in a parallel array.
 *
 * @param {string} text
 * @returns {string[]} de-duplicated, upper-cased, in first-appearance order
 */
function readInlineRefs(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  const seen = new Set();
  for (const m of text.matchAll(INTERNAL_REF)) {
    const ref = `${m[1]}${m[2]}`.toUpperCase();
    if (seen.has(ref)) continue;
    seen.add(ref);
    out.push(ref);
  }
  return out;
}

/** Numeric compare of two 'W<n>' refs. */
function compareRefs(a, b) {
  return Number(a.slice(1)) - Number(b.slice(1));
}

function clampIndex(value, len) {
  if (!Number.isFinite(value)) return len;
  return Math.max(0, Math.min(Math.trunc(value), len));
}

module.exports = { toWebSources, insertWebRefs, readInlineRefs, assignRefs };
