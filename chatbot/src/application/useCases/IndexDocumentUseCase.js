/**
 * IndexDocumentUseCase — one uploaded file to searchable chunks.
 *
 * The pipeline is validate -> hash -> parse -> chunk -> embed -> store, and it
 * reports progress at each step because embedding a large PDF takes seconds
 * and a silent UI is indistinguishable from a hung one.
 *
 * Every dependency is a port: the parser registry, the embedding gateway and
 * the repository. Nothing here knows about PDFs, OpenAI or SQLite.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { chunkDocument } = require('../../infrastructure/documents/chunker');
const { DocumentError } = require('../../domain/errors');

/**
 * Chunks embedded per request. Matches the gateway's own internal batch size,
 * so slicing here costs no extra HTTP requests — it only makes progress
 * observable, which one opaque embedBatch call over 200 chunks would not be.
 */
const EMBED_BATCH = 64;

/** Extension to MIME, for display and for the document list. */
const MIME_TYPES = Object.freeze({
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
});

function mimeTypeOf(fileName) {
  return MIME_TYPES[path.extname(String(fileName)).toLowerCase()] || 'application/octet-stream';
}

/** sha256 of the file, streamed so a 20 MB upload is never held twice. */
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (buf) => hash.update(buf));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

class IndexDocumentUseCase {
  /**
   * @param {Object} deps
   * @param {import('../../domain/ports/DocumentRepository').DocumentRepository} deps.documents
   * @param {import('../../domain/ports/EmbeddingGateway').EmbeddingGateway} deps.embeddings
   * @param {{forFile: Function, supports: Function, supportedExtensions: Function}} deps.parsers
   * @param {import('../../domain/ports/ChatLogger').ChatLogger} deps.logger
   * @param {{maxDocumentBytes:number, maxLibraryBytes:number, maxDocuments:number}} deps.limits
   */
  constructor({ documents, embeddings, parsers, logger, limits }) {
    this.documents = documents;
    this.embeddings = embeddings;
    this.parsers = parsers;
    this.logger = logger;
    this.limits = limits;
  }

  /**
   * @param {Object} req
   * @param {string} req.docId    caller-generated, so the UI can show a pending
   *                              row before indexing finishes
   * @param {string} req.filePath absolute path from the native file dialog
   * @param {string} [req.fileName]
   * @param {(p: {phase: string, done?: number, total?: number}) => void} [req.onProgress]
   * @returns {Promise<{docId:string, fileName:string, chunkCount:number, pageCount:number|null, deduped:boolean}>}
   */
  async execute({ docId, filePath, fileName, onProgress = () => {} }) {
    if (!docId || !String(docId).trim()) {
      throw new DocumentError('docId is required', 'DOCUMENT_INVALID_REQUEST');
    }
    if (!filePath || !String(filePath).trim()) {
      throw new DocumentError('filePath is required', 'DOCUMENT_INVALID_REQUEST');
    }

    const name = fileName || path.basename(filePath);
    const byteSize = this.validateFile(filePath, name);

    // Hash before inserting: a re-upload of a file already indexed must not
    // trip the unique content_hash index and surface as a SQLite error.
    const contentHash = await hashFile(filePath);
    const existing = this.documents.findByContentHash(contentHash);
    if (existing) {
      if (existing.status === 'ready') {
        this.logger.info('index_document', 'deduped', { docId: existing.docId, fileName: name });
        return {
          docId: existing.docId,
          fileName: existing.fileName,
          chunkCount: existing.chunkCount,
          pageCount: existing.pageCount,
          deduped: true,
        };
      }
      // A previous attempt died mid-flight (failed, or the process was killed
      // while indexing). Its row owns the hash and its chunks are partial, so
      // clear it and index afresh rather than leaving the user unable to retry.
      this.logger.warn('index_document', 'replacing_incomplete', {
        docId: existing.docId,
        status: existing.status,
      });
      this.documents.deleteDocument(existing.docId);
    }

    this.documents.insertDocument({
      docId,
      fileName: name,
      mimeType: mimeTypeOf(name),
      byteSize,
      pageCount: null,
      chunkCount: 0,
      embedModel: this.embeddings.model(),
      dimensions: this.embeddings.dimensions(),
      status: 'indexing',
      errorMessage: null,
      uploadedAt: new Date().toISOString(),
      contentHash,
      meetingId: null,
    });

    try {
      onProgress({ phase: 'parse' });
      const parsed = await this.parsers.forFile(name).parse(filePath);

      onProgress({ phase: 'chunk' });
      const chunks = chunkDocument(parsed);
      if (chunks.length === 0) {
        // A scanned PDF parses fine and yields nothing. Saying "no text" is
        // actionable; "0 chunks" is not.
        throw new DocumentError(
          `No readable text found in "${name}". If it is a scan, it needs OCR first.`,
          'DOCUMENT_NO_TEXT',
        );
      }

      const embedded = await this.embedChunks(chunks, onProgress);

      onProgress({ phase: 'store', done: chunks.length, total: chunks.length });
      this.documents.insertChunks(docId, embedded);
      this.documents.markReady(docId, {
        chunkCount: embedded.length,
        pageCount: parsed.pageCount ?? null,
      });

      this.logger.info('index_document', 'ready', {
        docId,
        fileName: name,
        chunks: embedded.length,
        pages: parsed.pageCount ?? null,
      });

      return {
        docId,
        fileName: name,
        chunkCount: embedded.length,
        pageCount: parsed.pageCount ?? null,
        deduped: false,
      };
    } catch (err) {
      // Record why on the row itself: the list endpoint is the only place the
      // user will look after the transient error toast is gone.
      try {
        this.documents.markFailed(docId, String(err.message).slice(0, 500));
      } catch (markErr) {
        this.logger.error('index_document', 'mark_failed_failed', { docId, message: markErr.message });
      }
      this.logger.error('index_document', 'failed', {
        docId,
        fileName: name,
        code: err.code || 'DOCUMENT_ERROR',
        message: err.message,
      });
      throw err;
    }
  }

  /**
   * Size and type gates, plus the library caps. Checked before any work is
   * done and before a row exists, so a rejected upload leaves no trace.
   * @returns {number} byte size
   * @private
   */
  validateFile(filePath, name) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (_) {
      throw new DocumentError(`File not found: ${filePath}`, 'DOCUMENT_NOT_FOUND');
    }
    if (!stat.isFile()) {
      throw new DocumentError(`Not a file: ${filePath}`, 'DOCUMENT_NOT_FOUND');
    }

    // Throws DOCUMENT_UNSUPPORTED_TYPE, listing what IS supported.
    this.parsers.forFile(name);

    const { maxDocumentBytes, maxLibraryBytes, maxDocuments } = this.limits;
    if (stat.size > maxDocumentBytes) {
      throw new DocumentError(
        `"${name}" is ${mb(stat.size)} MB; the limit is ${mb(maxDocumentBytes)} MB.`,
        'DOCUMENT_TOO_LARGE',
      );
    }
    if (stat.size === 0) {
      throw new DocumentError(`"${name}" is empty.`, 'DOCUMENT_NO_TEXT');
    }

    const { count, totalBytes } = this.documents.stats();
    if (count >= maxDocuments) {
      throw new DocumentError(
        `Document library is full (${count} of ${maxDocuments}). Remove one first.`,
        'DOCUMENT_LIBRARY_FULL',
      );
    }
    if (totalBytes + stat.size > maxLibraryBytes) {
      throw new DocumentError(
        `Adding "${name}" would exceed the ${mb(maxLibraryBytes)} MB library limit. Remove a document first.`,
        'DOCUMENT_LIBRARY_FULL',
      );
    }
    return stat.size;
  }

  /**
   * Embed in batches, reporting after each. The gateway batches internally at
   * the same size, so this adds no requests — only visibility.
   * @private
   */
  async embedChunks(chunks, onProgress) {
    const out = [];
    onProgress({ phase: 'embed', done: 0, total: chunks.length });
    for (let start = 0; start < chunks.length; start += EMBED_BATCH) {
      const slice = chunks.slice(start, start + EMBED_BATCH);
      const vectors = await this.embeddings.embedBatch(slice.map((c) => c.text), {
        tag: 'embed_document',
      });
      if (vectors.length !== slice.length) {
        throw new DocumentError(
          `Embedding returned ${vectors.length} vectors for ${slice.length} chunks`,
          'EMBED_COUNT_MISMATCH',
        );
      }
      slice.forEach((chunk, i) => out.push({ ...chunk, embedding: vectors[i] }));
      onProgress({ phase: 'embed', done: out.length, total: chunks.length });
    }
    return out;
  }
}

function mb(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

module.exports = { IndexDocumentUseCase, EMBED_BATCH };
