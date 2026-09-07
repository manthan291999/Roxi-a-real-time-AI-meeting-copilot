/**
 * DocxParser — .docx via mammoth (pure JS).
 *
 * DOCX has no page concept: pagination is decided by the renderer, not stored
 * in the file. So pageNumber is null and citations name the file only.
 */

'use strict';

const mammoth = require('mammoth');
const { DocumentError } = require('../../../domain/errors');

class DocxParser {
  constructor() {
    this.extensions = ['.docx'];
  }

  /** @returns {Promise<import('../../../domain/ports/DocumentParser').ParsedDocument>} */
  async parse(filePath) {
    try {
      const { value } = await mammoth.extractRawText({ path: filePath });
      const text = value || '';
      return {
        pages: text.trim() ? [{ pageNumber: null, text }] : [],
        pageCount: null,
      };
    } catch (err) {
      throw new DocumentError(
        `Could not read Word document: ${err.message}`,
        'DOCUMENT_PARSE_FAILED',
      );
    }
  }
}

module.exports = { DocxParser };
