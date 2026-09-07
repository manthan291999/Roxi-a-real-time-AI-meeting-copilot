const test = require('node:test');
const assert = require('node:assert');

const { chunkDocument } = require('../src/infrastructure/documents/chunker');

/** A page of `n` sentences, each distinctly numbered so overlap is visible. */
const sentences = (n, tag = 's') =>
  Array.from({ length: n }, (_, i) => `${tag}${i} the retry budget is per-endpoint.`).join(' ');

test('empty and degenerate input', async (t) => {
  await t.test('no pages -> no chunks', () => {
    assert.deepStrictEqual(chunkDocument({ pages: [] }), []);
  });

  await t.test('missing pages array -> no chunks, does not throw', () => {
    assert.deepStrictEqual(chunkDocument({}), []);
    assert.deepStrictEqual(chunkDocument(null), []);
  });

  await t.test('whitespace-only -> no chunks', () => {
    assert.deepStrictEqual(chunkDocument({ pages: [{ pageNumber: 1, text: '   \n\n  ' }] }), []);
  });

  await t.test('a single character is still one chunk', () => {
    const chunks = chunkDocument({ pages: [{ pageNumber: 1, text: 'x' }] });
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0].text, 'x');
    assert.strictEqual(chunks[0].chunkIndex, 0);
  });
});

test('sizing and overlap', async (t) => {
  await t.test('short input stays one chunk', () => {
    const chunks = chunkDocument({ pages: [{ pageNumber: 1, text: sentences(3) }] });
    assert.strictEqual(chunks.length, 1);
  });

  await t.test('long input splits, and no chunk exceeds the limit', () => {
    const chunks = chunkDocument(
      { pages: [{ pageNumber: 1, text: sentences(400) }] },
      { maxChars: 500, overlapChars: 100 },
    );
    assert.ok(chunks.length > 1, 'splits');
    for (const c of chunks) {
      assert.ok(c.text.length <= 500, `chunk ${c.chunkIndex} is ${c.text.length} chars`);
    }
  });

  await t.test('chunk indices are contiguous from zero', () => {
    const chunks = chunkDocument(
      { pages: [{ pageNumber: 1, text: sentences(200) }] },
      { maxChars: 400, overlapChars: 80 },
    );
    assert.deepStrictEqual(
      chunks.map((c) => c.chunkIndex),
      chunks.map((_, i) => i),
    );
  });

  await t.test('consecutive chunks overlap', () => {
    const chunks = chunkDocument(
      { pages: [{ pageNumber: 1, text: sentences(200) }] },
      { maxChars: 600, overlapChars: 200 },
    );
    assert.ok(chunks.length >= 2);
    // The second chunk must start before the first one ended.
    assert.ok(
      chunks[1].charStart < chunks[0].charEnd,
      `expected overlap, got start=${chunks[1].charStart} end=${chunks[0].charEnd}`,
    );
  });

  await t.test('zero overlap is honoured', () => {
    const chunks = chunkDocument(
      { pages: [{ pageNumber: 1, text: sentences(200) }] },
      { maxChars: 500, overlapChars: 0 },
    );
    for (let i = 1; i < chunks.length; i++) {
      assert.strictEqual(chunks[i].charStart, chunks[i - 1].charEnd);
    }
  });
});

test('boundary preference', async (t) => {
  await t.test('prefers a paragraph break', () => {
    const head = 'a'.repeat(320);
    const tail = 'b'.repeat(400);
    const chunks = chunkDocument(
      { pages: [{ pageNumber: 1, text: `${head}\n\n${tail}` }] },
      { maxChars: 400, overlapChars: 0 },
    );
    // The first chunk should stop at the blank line, not mid-way through 'a's.
    assert.strictEqual(chunks[0].text, head);
  });

  await t.test('falls back to a sentence end when there is no paragraph', () => {
    const text = `${'x'.repeat(300)}. ${'y'.repeat(300)}`;
    const chunks = chunkDocument(
      { pages: [{ pageNumber: 1, text }] },
      { maxChars: 400, overlapChars: 0 },
    );
    assert.ok(chunks[0].text.endsWith('.'), `got: ...${chunks[0].text.slice(-12)}`);
  });

  await t.test('hard-cuts text with no paragraph and no sentence break', () => {
    // One unbroken run — a minified blob or a wide table row.
    const text = 'z'.repeat(1000);
    const chunks = chunkDocument(
      { pages: [{ pageNumber: 1, text }] },
      { maxChars: 400, overlapChars: 0 },
    );
    assert.ok(chunks.length >= 3, `expected a hard cut into >=3, got ${chunks.length}`);
    assert.strictEqual(chunks[0].text.length, 400);
  });

  await t.test('an oversized overlap cannot explode the chunk count', () => {
    // overlapChars close to maxChars used to advance one character per step:
    // 1,604 chunks for this input, each separately embedded and billed. The
    // overlap is now capped at half the window, bounding output at
    // 2 * length / maxChars.
    const text = `${'a'.repeat(395)}\n\n${'b'.repeat(2000)}`;
    const chunks = chunkDocument({ pages: [{ pageNumber: 1, text }] }, {
      maxChars: 400,
      overlapChars: 399,
    });
    const ceiling = Math.ceil((2 * text.length) / 400) + 1;
    assert.ok(
      chunks.length > 0 && chunks.length <= ceiling,
      `expected <= ${ceiling} chunks, got ${chunks.length}`,
    );
  });
});

test('page numbers', async (t) => {
  await t.test('each chunk reports the page it begins on', () => {
    const chunks = chunkDocument(
      {
        pages: [
          { pageNumber: 1, text: 'p'.repeat(500) },
          { pageNumber: 2, text: 'q'.repeat(500) },
        ],
      },
      { maxChars: 400, overlapChars: 0 },
    );
    assert.strictEqual(chunks[0].pageNumber, 1);
    const onPage2 = chunks.filter((c) => c.pageNumber === 2);
    assert.ok(onPage2.length > 0, 'page 2 is represented');
    // Nothing may claim a page that does not exist.
    assert.ok(chunks.every((c) => c.pageNumber === 1 || c.pageNumber === 2));
  });

  await t.test('a null page number (docx, txt) is carried through as null', () => {
    const chunks = chunkDocument({ pages: [{ pageNumber: null, text: sentences(50) }] });
    assert.ok(chunks.length >= 1);
    assert.strictEqual(chunks[0].pageNumber, null);
  });

  await t.test('an empty page is skipped without shifting the others', () => {
    const chunks = chunkDocument({
      pages: [
        { pageNumber: 1, text: '' },
        { pageNumber: 2, text: 'real content on page two.' },
      ],
    });
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0].pageNumber, 2);
  });
});
