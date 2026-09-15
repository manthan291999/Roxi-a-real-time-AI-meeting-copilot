/**
 * Unit tests: webCitations — ref assignment, offset arithmetic, ref reading.
 *
 * All pure. The two things worth proving are that inline [W#] tokens and the
 * source cards cannot disagree about which URL is which, and that inserting
 * tokens does not corrupt the text around them.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const {
  toWebSources, insertWebRefs, readInlineRefs, assignRefs,
} = require('../src/application/graph/webCitations');
const { WEB_MAX_CITATIONS } = require('../src/application/graph/constants');

const TEXT = 'Node 22 is current LTS. Bun is at 1.2. Deno ships 2.1.';
const CITES = [
  { title: 'Node releases', url: 'https://nodejs.org/x', startIndex: 0, endIndex: 23 },
  { title: 'Bun blog', url: 'https://bun.sh/blog', startIndex: 24, endIndex: 38 },
  { title: 'Node again', url: 'https://nodejs.org/x', startIndex: 39, endIndex: 53 },
];

test('refs are assigned per URL, in first-appearance order', () => {
  const assigned = assignRefs(CITES);
  assert.deepStrictEqual([...assigned.keys()], ['https://nodejs.org/x', 'https://bun.sh/blog']);
  assert.strictEqual(assigned.get('https://nodejs.org/x').ref, 'W1');
  assert.strictEqual(assigned.get('https://bun.sh/blog').ref, 'W2');
});

test('a repeated URL reuses its ref instead of taking a second card', () => {
  const cards = toWebSources(CITES, TEXT);
  assert.deepStrictEqual(cards.map((c) => c.ref), ['W1', 'W2']);
  // …but the inline text still marks both places it was cited.
  const out = insertWebRefs(TEXT, CITES);
  assert.strictEqual((out.match(/\[W1\]/g) || []).length, 2);
});

test('cards carry the passage they actually support', () => {
  const cards = toWebSources(CITES, TEXT);
  assert.strictEqual(cards[0].snippet, 'Node 22 is current LTS.');
  assert.strictEqual(cards[1].snippet, 'Bun is at 1.2.');
  assert.strictEqual(cards[0].sourceType, 'web');
  assert.strictEqual(cards[0].url, 'https://nodejs.org/x');
  assert.strictEqual(cards[0].title, 'Node releases');
});

test('insertion is back to front, so no token lands mid-word', () => {
  const out = insertWebRefs(TEXT, CITES);
  // Every sentence keeps its own words intact around the inserted token.
  assert.ok(out.includes('Node 22 is current LTS. [W1]'), out);
  assert.ok(out.includes('Bun is at 1.2. [W2]'), out);
  // Front-to-back insertion would have shifted this one into "2. [W1]1".
  assert.ok(out.includes('Deno ships 2.1'), out);
});

test('two sources on the same sentence read W1 then W2', () => {
  const same = [
    { title: 'A', url: 'https://a.example', startIndex: 0, endIndex: 5 },
    { title: 'B', url: 'https://b.example', startIndex: 0, endIndex: 5 },
  ];
  assert.strictEqual(insertWebRefs('Hello world', same), 'Hello [W1] [W2] world');
});

test('citations beyond the cap get neither a card nor a token', () => {
  const many = Array.from({ length: WEB_MAX_CITATIONS + 3 }, (_, i) => ({
    title: `S${i}`, url: `https://s${i}.example`, startIndex: 0, endIndex: 4,
  }));
  const cards = toWebSources(many, 'text');
  assert.strictEqual(cards.length, WEB_MAX_CITATIONS);
  const out = insertWebRefs('text', many);
  assert.ok(!out.includes(`[W${WEB_MAX_CITATIONS + 1}]`), out);
});

test('out-of-range and missing offsets are clamped, never thrown on', () => {
  const wild = [
    { title: 'X', url: 'https://x.example', startIndex: -50, endIndex: 9999 },
    { title: 'Y', url: 'https://y.example' },
  ];
  const out = insertWebRefs('short', wild);
  assert.ok(out.startsWith('short'), out);
  assert.ok(out.includes('[W1]'));
  const cards = toWebSources(wild, 'short');
  assert.strictEqual(cards.length, 2);
});

test('empty and malformed input is returned untouched', () => {
  assert.strictEqual(insertWebRefs('', CITES), '');
  assert.strictEqual(insertWebRefs('abc', []), 'abc');
  assert.strictEqual(insertWebRefs('abc', null), 'abc');
  assert.deepStrictEqual(toWebSources(null), []);
  assert.deepStrictEqual(toWebSources([{ title: 'no url' }]), []);
});

test('a token the model already wrote is not doubled', () => {
  const text = 'Already cited [W1] here.';
  const cites = [{ title: 'A', url: 'https://a.example', startIndex: 0, endIndex: 14 }];
  assert.strictEqual((insertWebRefs(text, cites).match(/\[W1\]/g) || []).length, 1);
});

test('readInlineRefs picks up every internal corpus and skips the web', () => {
  const answer = 'SQLite [M1] with WAL [D2], said live [L1]; see glossary [G1]. Web says [W1].';
  assert.deepStrictEqual(readInlineRefs(answer), ['M1', 'D2', 'L1', 'G1']);
});

test('readInlineRefs de-duplicates and keeps first-appearance order', () => {
  assert.deepStrictEqual(readInlineRefs('[D2] then [M1] then [D2] again'), ['D2', 'M1']);
  assert.deepStrictEqual(readInlineRefs('no refs here'), []);
  assert.deepStrictEqual(readInlineRefs(null), []);
});


// --- the shape the live API actually returns ----------------------------
//
// Captured from a real Responses call, not guessed: the provider writes its
// own inline markdown link into the prose and the annotation span covers THAT
// LINK. Getting this wrong printed a 60-character URL mid-sentence in a
// renderer that does not parse markdown, and cited each source twice.

const LIVE_ANSWER = [
  'As of **September 11, 2026**:',
  '',
  '- **Node.js**',
  '  - **Current:** `v26.8.2`',
  '  - **LTS:** `v24.21.0` ([nodejs.org](https://nodejs.org/en/blog/release?utm_source=openai))',
].join('\n');

const LIVE_CITES = [{
  title: 'Node.js',
  url: 'https://nodejs.org/en/blog/release?utm_source=openai',
  startIndex: LIVE_ANSWER.indexOf('([nodejs.org]'),
  endIndex: LIVE_ANSWER.length,
}];

test('a provider link span is replaced by the token, not followed by it', () => {
  const out = insertWebRefs(LIVE_ANSWER, LIVE_CITES);
  assert.ok(out.includes('`v24.21.0` [W1]'), out);
  // The whole point: no raw URL and no markdown left in the prose.
  assert.ok(!out.includes('https://'), out);
  assert.ok(!out.includes('](', out.indexOf('[W1]')), out);
  assert.strictEqual((out.match(/\[W1\]/g) || []).length, 1);
});

test('a link span takes its snippet from the passage in front of it', () => {
  // The span itself is link markup and says nothing a reader wants.
  const [card] = toWebSources(LIVE_CITES, LIVE_ANSWER);
  assert.strictEqual(card.snippet, 'LTS: v24.21.0');
  assert.strictEqual(card.url, 'https://nodejs.org/en/blog/release?utm_source=openai');
});

test('a bare markdown link span, with no wrapping parentheses, also replaces', () => {
  const text = 'Node 22 is LTS [nodejs.org](https://nodejs.org/x)';
  const cites = [{
    title: 'N', url: 'https://nodejs.org/x',
    startIndex: text.indexOf('[nodejs.org]'), endIndex: text.length,
  }];
  assert.strictEqual(insertWebRefs(text, cites), 'Node 22 is LTS [W1]');
});

test('a span carrying prose as well as a link is kept, never deleted', () => {
  // Anchored detection matters here: replacing this span would delete the
  // answer's own words along with the link.
  const text = 'Node 22 is LTS according to [the docs](https://nodejs.org/x) today.';
  const cites = [{ title: 'N', url: 'https://nodejs.org/x', startIndex: 0, endIndex: text.length }];
  const out = insertWebRefs(text, cites);
  assert.ok(out.includes('Node 22 is LTS according to'), out);
  assert.ok(out.includes('[W1]'), out);
});

test('two link spans in one answer both replace, and refs stay in order', () => {
  const text = 'Node is at 22 ([a](https://a.example)) and Deno at 2 ([b](https://b.example))';
  const cites = [
    { title: 'A', url: 'https://a.example', startIndex: text.indexOf('([a]'), endIndex: text.indexOf(') and') + 1 },
    { title: 'B', url: 'https://b.example', startIndex: text.indexOf('([b]'), endIndex: text.length },
  ];
  const out = insertWebRefs(text, cites);
  assert.strictEqual(out, 'Node is at 22 [W1] and Deno at 2 [W2]');
});

test('card snippets are stripped of the light markdown the prompts ask for', () => {
  const text = '- **Stable:** `v2.9.6` ([deno.com](https://deno.com/))';
  const cites = [{
    title: 'Deno', url: 'https://deno.com/',
    startIndex: text.indexOf('([deno.com]'), endIndex: text.length,
  }];
  assert.strictEqual(toWebSources(cites, text)[0].snippet, 'Stable: v2.9.6');
});

test('a long preceding passage is trimmed from the end, nearest the citation', () => {
  const prose = 'x'.repeat(400);
  const text = `${prose} ([a](https://a.example))`;
  const cites = [{
    title: 'A', url: 'https://a.example',
    startIndex: text.indexOf('([a]'), endIndex: text.length,
  }];
  const { snippet } = toWebSources(cites, text)[0];
  assert.ok(snippet.startsWith('…'), snippet.slice(0, 20));
  assert.ok(snippet.length <= 181, String(snippet.length));
});
