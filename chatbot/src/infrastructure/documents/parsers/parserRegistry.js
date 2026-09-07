/**
 * parserRegistry — extension to DocumentParser.
 *
 * The one place that knows which formats are supported. Adding .pptx is a new
 * adapter plus one entry in PARSERS; no caller changes (Open/Closed).
 */

'use strict';

const path = require('path');
const { TextParser } = require('./TextParser');
const { PdfParser } = require('./PdfParser');
const { DocxParser } = require('./DocxParser');
const { DocumentError } = require('../../../domain/errors');

/**
 * Build the registry.
 *
 * Instances are created once and shared: all three adapters are stateless, and
 * constructing a parser per upload would buy nothing.
 *
 * @param {Array<{extensions: string[]}>} [parsers] injectable for tests
 */
function createParserRegistry(parsers = [new TextParser(), new PdfParser(), new DocxParser()]) {
  const byExtension = new Map();
  for (const parser of parsers) {
    for (const ext of parser.extensions) {
      byExtension.set(ext.toLowerCase(), parser);
    }
  }

  return {
    /** Every extension the app can accept, for validation and the file dialog. */
    supportedExtensions: () => [...byExtension.keys()].sort(),

    supports: (fileName) => byExtension.has(path.extname(String(fileName)).toLowerCase()),

    /**
     * @param {string} fileName
     * @returns {{extensions: string[], parse: Function}}
     * @throws {DocumentError} for an unsupported extension
     */
    forFile: (fileName) => {
      const ext = path.extname(String(fileName)).toLowerCase();
      const parser = byExtension.get(ext);
      if (!parser) {
        throw new DocumentError(
          `Unsupported file type "${ext || fileName}". Supported: ${[...byExtension.keys()].sort().join(', ')}`,
          'DOCUMENT_UNSUPPORTED_TYPE',
        );
      }
      return parser;
    },
  };
}

module.exports = { createParserRegistry };
