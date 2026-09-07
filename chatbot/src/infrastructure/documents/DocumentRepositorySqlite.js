/**
 * DocumentRepositorySqlite — better-sqlite3 adapter for DocumentRepository.
 *
 * Vectors are stored as Float32LE BLOBs, L2-normalized at write time, so
 * cosine similarity at query time is a plain dot product. Search is a
 * brute-force scan: a few thousand 1,536-dim vectors is a few million
 * multiply-adds, single-digit milliseconds, which is far cheaper than owning a
 * vector index or shipping a native SQLite extension. Revisit past ~50k chunks.
 *
 * Never throws for a missing row — callers get null/[]/false. A genuine
 * database failure does throw, wrapped as StoreError, because the caller must
 * not report a document as indexed when it is not.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('./migrations');
const { StoreError } = require('../../domain/errors');

/**
 * Decode a SQLite BLOB into a Float32Array.
 *
 * Copies rather than views the Buffer: better-sqlite3's Buffer is a slice of a
 * shared pool whose byteOffset is not guaranteed to be 4-byte aligned, and
 * Float32Array requires alignment.
 */
function decodeVector(blob) {
  const copy = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
  return new Float32Array(copy);
}

/** Encode a Float32Array for storage. */
function encodeVector(vector) {
  const f32 = vector instanceof Float32Array ? vector : Float32Array.from(vector);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

/** Dot product. Equals cosine similarity when both inputs are unit length. */
function dot(a, b) {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += a[i] * b[i];
  return sum;
}

function toRow(r) {
  if (!r) return null;
  return {
    docId: r.doc_id,
    fileName: r.file_name,
    mimeType: r.mime_type,
    byteSize: r.byte_size,
    pageCount: r.page_count,
    chunkCount: r.chunk_count,
    embedModel: r.embed_model,
    dimensions: r.dimensions,
    status: r.status,
    errorMessage: r.error_message,
    uploadedAt: r.uploaded_at,
    contentHash: r.content_hash,
    meetingId: r.meeting_id,
  };
}

class DocumentRepositorySqlite {
  /**
   * @param {string} dbPath absolute path, or ':memory:' in tests
   * @param {import('../../domain/ports/ChatLogger').ChatLogger} [logger]
   */
  constructor(dbPath, logger = null) {
    this.logger = logger;
    try {
      if (dbPath !== ':memory:') {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      }
      this.db = new Database(dbPath);
    } catch (err) {
      throw new StoreError(`Cannot open document store at ${dbPath}: ${err.message}`);
    }

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    // Required for document_chunks' ON DELETE CASCADE — SQLite ignores it
    // otherwise, which would orphan every chunk of a deleted document.
    this.db.pragma('foreign_keys = ON');

    const version = runMigrations(this.db, {
      onApplied: (m) =>
        this.logger?.info('doc_store', 'migration_applied', {
          version: m.version,
          description: m.description,
        }),
    });
    this.logger?.debug('doc_store', 'ready', { dbPath, version });

    this.stmts = {
      insertDoc: this.db.prepare(`
        INSERT INTO documents (
          doc_id, file_name, mime_type, byte_size, page_count, chunk_count,
          embed_model, dimensions, status, error_message, uploaded_at,
          content_hash, meeting_id
        ) VALUES (
          @docId, @fileName, @mimeType, @byteSize, @pageCount, @chunkCount,
          @embedModel, @dimensions, @status, @errorMessage, @uploadedAt,
          @contentHash, @meetingId
        )
      `),
      insertChunk: this.db.prepare(`
        INSERT INTO document_chunks (
          chunk_id, doc_id, chunk_index, page_number, char_start, char_end, text, embedding
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      markReady: this.db.prepare(`
        UPDATE documents
           SET status = 'ready', chunk_count = ?, page_count = ?, error_message = NULL
         WHERE doc_id = ?
      `),
      markFailed: this.db.prepare(
        "UPDATE documents SET status = 'failed', error_message = ? WHERE doc_id = ?",
      ),
      getDoc: this.db.prepare('SELECT * FROM documents WHERE doc_id = ?'),
      byHash: this.db.prepare('SELECT * FROM documents WHERE content_hash = ?'),
      listDocs: this.db.prepare('SELECT * FROM documents ORDER BY uploaded_at DESC'),
      deleteDoc: this.db.prepare('DELETE FROM documents WHERE doc_id = ?'),
      stats: this.db.prepare(
        'SELECT COUNT(*) AS count, COALESCE(SUM(byte_size), 0) AS totalBytes FROM documents',
      ),
      // Only ready documents are searchable: a half-indexed one would answer
      // from a partial corpus without saying so.
      readyChunks: this.db.prepare(`
        SELECT c.chunk_id, c.doc_id, c.chunk_index, c.page_number, c.text, c.embedding,
               d.file_name
          FROM document_chunks c
          JOIN documents d ON d.doc_id = c.doc_id
         WHERE d.status = 'ready'
      `),
    };
  }

  insertDocument(doc) {
    this.stmts.insertDoc.run({
      docId: doc.docId,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      byteSize: doc.byteSize,
      pageCount: doc.pageCount ?? null,
      chunkCount: doc.chunkCount ?? 0,
      embedModel: doc.embedModel,
      dimensions: doc.dimensions,
      status: doc.status || 'indexing',
      errorMessage: doc.errorMessage ?? null,
      uploadedAt: doc.uploadedAt || new Date().toISOString(),
      contentHash: doc.contentHash,
      meetingId: doc.meetingId ?? null,
    });
  }

  /** One transaction: a partial write would leave a document searchable in part. */
  insertChunks(docId, chunks) {
    const write = this.db.transaction((rows) => {
      for (const c of rows) {
        this.stmts.insertChunk.run(
          `${docId}:${c.chunkIndex}`,
          docId,
          c.chunkIndex,
          c.pageNumber ?? null,
          c.charStart,
          c.charEnd,
          c.text,
          encodeVector(c.embedding),
        );
      }
    });
    write(chunks);
  }

  markReady(docId, { chunkCount, pageCount }) {
    this.stmts.markReady.run(chunkCount, pageCount ?? null, docId);
  }

  markFailed(docId, message) {
    this.stmts.markFailed.run(String(message || 'Unknown error').slice(0, 500), docId);
  }

  getDocument(docId) {
    return toRow(this.stmts.getDoc.get(docId));
  }

  findByContentHash(hash) {
    return toRow(this.stmts.byHash.get(hash));
  }

  listDocuments() {
    return this.stmts.listDocs.all().map(toRow);
  }

  deleteDocument(docId) {
    return this.stmts.deleteDoc.run(docId).changes > 0;
  }

  stats() {
    const r = this.stmts.stats.get();
    return { count: r.count || 0, totalBytes: r.totalBytes || 0 };
  }

  /**
   * @param {Float32Array} queryVector must be L2-normalized
   * @param {{limit?: number, minSimilarity?: number}} [opts]
   * @returns {import('../../domain/ports/DocumentRepository').ChunkHit[]}
   */
  searchByVector(queryVector, opts = {}) {
    const limit = opts.limit || 10;
    const minSimilarity = opts.minSimilarity == null ? 0 : opts.minSimilarity;
    if (!queryVector || !queryVector.length) return [];

    const hits = [];
    for (const row of this.stmts.readyChunks.all()) {
      const similarity = dot(queryVector, decodeVector(row.embedding));
      if (similarity < minSimilarity) continue;
      hits.push({
        chunkId: row.chunk_id,
        docId: row.doc_id,
        fileName: row.file_name,
        chunkIndex: row.chunk_index,
        pageNumber: row.page_number,
        text: row.text,
        similarity,
      });
    }

    // Tie-break on chunkId so ordering is deterministic across runs.
    hits.sort((a, b) => b.similarity - a.similarity || a.chunkId.localeCompare(b.chunkId));
    return hits.slice(0, limit);
  }

  close() {
    try {
      this.db.close();
    } catch (_) {
      /* best effort */
    }
  }
}

module.exports = { DocumentRepositorySqlite, encodeVector, decodeVector, dot };
