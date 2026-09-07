/**
 * Unit tests: parser selection. No file I/O and no parser dependency is
 * exercised — this is purely the extension -> adapter mapping.
 */
const test = require('node:test');
const assert = require('node:assert');

const { createParserRegistry } = require('../src/infrastructure/documents/parsers/parserRegistry');
const { ChatbotError, DocumentError } = require('../src/domain/errors');

const fake = (extensions, id) => ({ extensions, id, parse: async () => ({ pages: [], pageCount: null }) });

test('selection by extension', async (t) => {
  const registry = createParserRegistry([fake(['.txt', '.md'], 'text'), fake(['.pdf'], 'pdf')]);

  await t.test('maps each declared extension to its adapter', () => {
    assert.strictEqual(registry.forFile('notes.txt').id, 'text');
    assert.strictEqual(registry.forFile('readme.md').id, 'text');
    assert.strictEqual(registry.forFile('spec.pdf').id, 'pdf');
  });

  await t.test('extension matching is case-insensitive', () => {
    assert.strictEqual(registry.forFile('SPEC.PDF').id, 'pdf');
    assert.strictEqual(registry.forFile('Notes.TxT').id, 'text');
  });

  await t.test('a full path resolves the same as a bare name', () => {
    assert.strictEqual(registry.forFile('/Users/x/My Docs/spec.pdf').id, 'pdf');
  });

  await t.test('a dotted filename uses the LAST extension', () => {
    assert.strictEqual(registry.forFile('v1.2.final.pdf').id, 'pdf');
  });

  await t.test('supports() agrees with forFile()', () => {
    assert.strictEqual(registry.supports('a.pdf'), true);
    assert.strictEqual(registry.supports('a.pptx'), false);
  });

  await t.test('supportedExtensions lists every registered extension, sorted', () => {
    assert.deepStrictEqual(registry.supportedExtensions(), ['.md', '.pdf', '.txt']);
  });
});

test('unsupported input throws a typed, actionable error', async (t) => {
  const registry = createParserRegistry([fake(['.pdf'], 'pdf')]);

  await t.test('unknown extension', () => {
    assert.throws(() => registry.forFile('deck.pptx'), (err) => {
      assert.ok(err instanceof DocumentError, 'is a DocumentError');
      assert.ok(err instanceof ChatbotError, 'and therefore a ChatbotError the transport maps');
      assert.strictEqual(err.code, 'DOCUMENT_UNSUPPORTED_TYPE');
      // The message has to name what IS accepted, or the user cannot act on it.
      assert.match(err.message, /\.pdf/);
      return true;
    });
  });

  await t.test('no extension at all', () => {
    assert.throws(() => registry.forFile('Makefile'), { code: 'DOCUMENT_UNSUPPORTED_TYPE' });
  });
});

test('the default registry covers the shipped formats', () => {
  const registry = createParserRegistry();
  assert.deepStrictEqual(registry.supportedExtensions(), [
    '.docx',
    '.markdown',
    '.md',
    '.pdf',
    '.txt',
  ]);
  // Each shipped adapter is reachable.
  for (const name of ['a.txt', 'a.md', 'a.markdown', 'a.pdf', 'a.docx']) {
    assert.ok(typeof registry.forFile(name).parse === 'function', name);
  }
});
