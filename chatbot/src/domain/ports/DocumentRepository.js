/**
 * Port: DocumentRepository — persistence for uploaded documents and their
 * embedded chunks.
 *
 * Vector search lives here rather than in a separate index because the corpus
 * is small: a brute-force dot product over a few thousand normalized 1,536-dim
 * vectors is single-digit milliseconds, so no vector database, native
 * extension or extra bundled artifact is needed. Revisit past ~50k chunks.
 *
 * Every vector is stored L2-normalized, which makes cosine similarity a plain
 * dot product at query time — no per-query square roots.
 *
 * Documents are scoped to a project, or global. `projectId: null` means global
 * — visible to every project — which is both the pre-D002 behaviour and the
 * right default for a shared template. Scoped reads match
 * `project_id IS NULL OR project_id = ?`, and implementations must push that
 * into the query rather than filter results: `searchByVector` truncates to
 * `limit`, so post-filtering would let out-of-scope chunks eat slots.
 *
 * @typedef {Object} DocumentRow
 * @property {string} docId
 * @property {string} fileName
 * @property {string} mimeType
 * @property {number} byteSize
 * @property {number|null} pageCount
 * @property {number} chunkCount
 * @property {string} embedModel   provenance: re-embed if the model changes
 * @property {number} dimensions
 * @property {'indexing'|'ready'|'failed'} status
 * @property {string|null} errorMessage
 * @property {string} uploadedAt
 * @property {string} contentHash  sha256; dedupes re-uploads of the same file
 * @property {number|null} projectId  owning project; null = global
 *
 * @typedef {Object} ChunkInput
 * @property {number} chunkIndex
 * @property {number|null} pageNumber
 * @property {number} charStart
 * @property {number} charEnd
 * @property {string} text
 * @property {Float32Array} embedding must be L2-normalized
 *
 * @typedef {Object} ChunkHit
 * @property {string} chunkId
 * @property {string} docId
 * @property {string} fileName
 * @property {number} chunkIndex
 * @property {number|null} pageNumber
 * @property {string} text
 * @property {number} similarity cosine, 0..1
 *
 * @interface DocumentRepository
 * @method insertDocument   @param {DocumentRow} doc @returns {void}
 * @method insertChunks     @param {string} docId @param {ChunkInput[]} chunks @returns {void}
 * @method markReady        @param {string} docId @param {{chunkCount:number,pageCount:number|null}} info
 * @method markFailed       @param {string} docId @param {string} message
 * @method getDocument      @param {string} docId @returns {DocumentRow|null}
 * @method findByContentHash @param {string} hash @returns {DocumentRow|null}
 * @method listDocuments    @returns {DocumentRow[]} always the whole library — the
 *   manage/library view shows everything regardless of the active project
 * @method deleteDocument   @param {string} docId @returns {boolean}
 * @method stats            @param {{projectId?:number|null}} [opts] @returns {{count:number, totalBytes:number}}
 * @method searchByVector   @param {Float32Array} queryVector @param {{limit?:number, minSimilarity?:number, projectId?:number|null}} [opts] @returns {ChunkHit[]}
 * @method close            @returns {void}
 */
module.exports = {};
