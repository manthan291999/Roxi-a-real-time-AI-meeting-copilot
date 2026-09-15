/**
 * A small block/inline parser for the markdown the model is actually asked
 * to produce.
 *
 * Why not a markdown library: the prompts in `chatbot/src/infrastructure/llm/
 * prompts.js` constrain every answer to "light markdown (bullets, inline
 * code)" with fenced code blocks and no headings. That is a small, known
 * grammar. A full CommonMark parser would add a large dependency to a 330 kB
 * always-on-top overlay, and — the deciding reason — the citation tokens the
 * chat renders (`[M64]`, `[W1]`) have to interleave with inline formatting,
 * which means reaching into a library's text nodes anyway.
 *
 * Everything here is pure and returns data, never HTML strings, so the
 * renderer can build React elements and no `dangerouslySetInnerHTML` is
 * needed anywhere.
 *
 * Deliberate omissions, each because the cost outweighs the benefit here:
 * tables, blockquotes, reference links, HTML passthrough. Anything
 * unrecognised falls through as plain text rather than being mangled.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; v: string }
  | { t: 'italic'; v: string }
  | { t: 'code'; v: string }
  | { t: 'link'; v: string; href: string };

export interface ListNode {
  ordered: boolean;
  start: number;
  items: { inline: string; children: ListNode | null }[];
}

export type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'list'; list: ListNode }
  | { kind: 'heading'; text: string }
  | { kind: 'rule' };

const FENCE = /^\s*(`{3,}|~{3,})\s*([A-Za-z0-9+#._-]*)\s*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const RULE = /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/;

/**
 * Split source text into blocks.
 *
 * Single newlines INSIDE a paragraph are kept as soft breaks rather than
 * collapsed the way CommonMark would. In a chat answer a line break is
 * almost always meant literally, and collapsing them runs short lines
 * together into one wall of text — which is how this looked before.
 */
export function parseBlocks(src: string): Block[] {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push({ kind: 'p', lines: para });
    para = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // ---- fenced code -----------------------------------------------------
    const fence = line.match(FENCE);
    if (fence) {
      flushPara();
      const closer = fence[1][0];
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        const m = lines[i].match(FENCE);
        if (m && m[1][0] === closer) break;
        body.push(lines[i]);
        i += 1;
      }
      // An unclosed fence still yields a block: the model was cut off by a
      // token cap, and showing the code is better than showing backticks.
      blocks.push({ kind: 'code', lang: fence[2] || '', text: body.join('\n') });
      continue;
    }

    if (!line.trim()) { flushPara(); continue; }

    if (RULE.test(line)) { flushPara(); blocks.push({ kind: 'rule' }); continue; }

    const heading = line.match(HEADING);
    if (heading) {
      flushPara();
      blocks.push({ kind: 'heading', text: heading[2].trim() });
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      flushPara();
      const raw: { indent: number; ordered: boolean; num: number; text: string }[] = [];
      while (i < lines.length) {
        const b = lines[i].match(BULLET);
        const o = lines[i].match(ORDERED);
        if (b) raw.push({ indent: b[1].length, ordered: false, num: 0, text: b[2] });
        else if (o) raw.push({ indent: o[1].length, ordered: true, num: Number(o[2]), text: o[3] });
        else if (lines[i].trim() && raw.length && /^\s{2,}/.test(lines[i])) {
          // A continuation line of the previous item, not a new one.
          raw[raw.length - 1].text += ` ${lines[i].trim()}`;
        } else break;
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: 'list', list: buildList(raw) });
      continue;
    }

    para.push(line);
  }
  flushPara();
  return blocks;
}

/**
 * Turn flat, indented items into a tree.
 *
 * Indent width is discovered from the content rather than assumed to be two
 * spaces or four: models emit both, sometimes in the same answer, so a fixed
 * divisor would silently flatten one style and over-nest the other.
 */
function buildList(
  raw: { indent: number; ordered: boolean; num: number; text: string }[]
): ListNode {
  const root: ListNode = { ordered: raw[0]?.ordered ?? false, start: raw[0]?.num || 1, items: [] };
  const stack: { indent: number; node: ListNode }[] = [{ indent: raw[0]?.indent ?? 0, node: root }];

  for (const item of raw) {
    while (stack.length > 1 && item.indent < stack[stack.length - 1].indent) stack.pop();
    let top = stack[stack.length - 1];

    if (item.indent > top.indent) {
      const parentItems = top.node.items;
      if (parentItems.length === 0) {
        // Indented with nothing to hang from; treat it as a sibling.
        parentItems.push({ inline: item.text, children: null });
        continue;
      }
      const child: ListNode = { ordered: item.ordered, start: item.num || 1, items: [] };
      parentItems[parentItems.length - 1].children = child;
      stack.push({ indent: item.indent, node: child });
      top = stack[stack.length - 1];
    }
    top.node.items.push({ inline: item.text, children: null });
  }
  return root;
}

const INLINE = new RegExp(
  [
    '(`[^`\\n]+`)',                       // code span, first so its content stays literal
    '(\\[[^\\]\\n]+\\]\\([^)\\s]+\\))',   // [label](href)
    '(\\*\\*[^\\s*][^*]*?\\*\\*)',        // **bold**
    '(\\*[^\\s*][^*]*?\\*)',              // *italic*
  ].join('|'),
  'g'
);

/**
 * Split one line into inline runs.
 *
 * `_underscores_` are deliberately NOT italic markers. This app's answers are
 * full of identifiers like `max_tool_calls` and `web_search_preview`, and
 * treating those as emphasis eats the underscores out of the name — a worse
 * failure than missing a rare italic.
 *
 * Citation tokens such as `[M64]` and `[W1]` have no `(href)` after them, so
 * the link pattern skips them and they arrive intact as 'text' runs, which is
 * what lets the chat resolve them to meeting names and source chips.
 */
export function parseInline(line: string): Inline[] {
  const src = String(line ?? '');
  const out: Inline[] = [];
  let last = 0;

  for (const m of src.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ t: 'text', v: src.slice(last, at) });
    const tok = m[0];

    if (tok.startsWith('`')) {
      out.push({ t: 'code', v: tok.slice(1, -1) });
    } else if (tok.startsWith('[')) {
      const split = tok.indexOf('](');
      out.push({ t: 'link', v: tok.slice(1, split), href: tok.slice(split + 2, -1) });
    } else if (tok.startsWith('**')) {
      out.push({ t: 'bold', v: tok.slice(2, -2) });
    } else {
      out.push({ t: 'italic', v: tok.slice(1, -1) });
    }
    last = at + tok.length;
  }
  if (last < src.length) out.push({ t: 'text', v: src.slice(last) });
  return out;
}
