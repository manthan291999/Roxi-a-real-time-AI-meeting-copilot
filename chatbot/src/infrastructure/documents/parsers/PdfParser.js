/**
 * PdfParser — PDF via pdf-parse (pure JS, no native binary to bundle).
 *
 * pdf-parse v2 exposes a PDFParse class whose getText() already returns
 * page-wise results ({ pages: [{ num, text }], total }), so real page numbers
 * come for free — no custom pagerender hook, which is what v1 required.
 *
 * If fidelity ever disappoints on a real-world PDF, swap this one file for a
 * pdfjs-dist adapter; the DocumentParser port is what makes that contained.
 */

'use strict';

const fs = require('fs/promises');
const { PDFParse } = require('pdf-parse');
const { DocumentError } = require('../../../domain/errors');

class PdfParser {
  constructor() {
    this.extensions = ['.pdf'];
  }

  /** @returns {Promise<import('../../../domain/ports/DocumentParser').ParsedDocument>} */
  async parse(filePath) {
    const buffer = await fs.readFile(filePath);
    // verbosity 0 keeps pdf.js warnings off our stdout, which is the protocol
    // channel — a stray line there would be parsed as a protocol message.
    const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity: 0 });

    try {
      const result = await parser.getText();
      const pages = (result.pages || [])
        .filter((p) => p && typeof p.text === 'string' && p.text.trim())
        .map((p) => ({ pageNumber: p.num, text: p.text }));

      if (pages.length === 0) {
        // A PDF of scanned images has no text layer. Say so, rather than
        // indexing an empty document the user believes is searchable.
        throw new DocumentError(
          'No selectable text found in this PDF. It may be a scan that needs OCR.',
          'DOCUMENT_NO_TEXT',
        );
      }

      return { pages, pageCount: result.total ?? pages.length };
    } catch (err) {
      if (err instanceof DocumentError) throw err;
      throw new DocumentError(`Could not read PDF: ${err.message}`, 'DOCUMENT_PARSE_FAILED');
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
}

module.exports = { PdfParser };
