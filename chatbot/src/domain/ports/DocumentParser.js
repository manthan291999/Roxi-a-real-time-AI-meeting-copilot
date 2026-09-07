/**
 * Port: DocumentParser — turns one uploaded file into page-wise plain text.
 *
 * One adapter per format, selected by extension through parserRegistry. Adding
 * a format is a new adapter plus one registry entry; nothing else moves
 * (Open/Closed).
 *
 * Implementations must not throw for an empty document — they return zero
 * pages, and the caller decides whether that is an error.
 *
 * @typedef {Object} ParsedPage
 * @property {number|null} pageNumber 1-based, or null where the format has no
 *   page concept (DOCX, plain text). Carried through chunking so a citation
 *   can say "p4".
 * @property {string} text
 *
 * @typedef {Object} ParsedDocument
 * @property {ParsedPage[]} pages
 * @property {number|null} pageCount null when the format is not paginated.
 *
 * @interface DocumentParser
 * @property {string[]} extensions lower-case, leading dot (e.g. ['.pdf'])
 * @method parse @param {string} filePath @returns {Promise<ParsedDocument>}
 */
module.exports = {};
