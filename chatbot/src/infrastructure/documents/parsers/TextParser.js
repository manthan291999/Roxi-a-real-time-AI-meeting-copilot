/**
 * TextParser — plain text and Markdown. No dependency.
 *
 * Neither format is paginated, so the whole file is one synthetic page with a
 * null page number; citations then say the file name without a page.
 */

'use strict';

const fs = require('fs/promises');

class TextParser {
  constructor() {
    this.extensions = ['.txt', '.md', '.markdown'];
  }

  /** @returns {Promise<import('../../../domain/ports/DocumentParser').ParsedDocument>} */
  async parse(filePath) {
    const text = await fs.readFile(filePath, 'utf8');
    return {
      pages: text.trim() ? [{ pageNumber: null, text }] : [],
      pageCount: null,
    };
  }
}

module.exports = { TextParser };
