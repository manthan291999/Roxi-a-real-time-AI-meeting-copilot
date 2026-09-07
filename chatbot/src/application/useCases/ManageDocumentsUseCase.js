/**
 * ManageDocumentsUseCase — list and delete the uploaded document library.
 *
 * Separate from IndexDocumentUseCase because the lifecycles differ: indexing
 * is a long, failure-prone, progress-reporting operation, while these two are
 * immediate local reads/writes. Keeping them apart is what lets the sidecar
 * answer a list request while an upload is still embedding.
 */

'use strict';

const { DocumentError } = require('../../domain/errors');

class ManageDocumentsUseCase {
  /**
   * @param {Object} deps
   * @param {import('../../domain/ports/DocumentRepository').DocumentRepository} deps.documents
   * @param {import('../../domain/ports/ChatLogger').ChatLogger} deps.logger
   */
  constructor({ documents, logger }) {
    this.documents = documents;
    this.logger = logger;
  }

  /**
   * The library as the protocol sends it.
   *
   * `status` and `errorMessage` are included deliberately: a failed document
   * still has a row, and the list is the only place the user can find out why
   * after the error toast is gone.
   *
   * @returns {Array<Object>}
   */
  list() {
    return this.documents.listDocuments().map((doc) => ({
      docId: doc.docId,
      fileName: doc.fileName,
      chunkCount: doc.chunkCount,
      pageCount: doc.pageCount,
      uploadedAt: doc.uploadedAt,
      bytes: doc.byteSize,
      status: doc.status,
      errorMessage: doc.errorMessage,
    }));
  }

  /**
   * @param {string} docId
   * @returns {{docId: string}}
   * @throws {DocumentError} when no such document exists
   */
  remove(docId) {
    if (!docId || !String(docId).trim()) {
      throw new DocumentError('docId is required', 'DOCUMENT_INVALID_REQUEST');
    }
    // Chunks go with it: document_chunks is ON DELETE CASCADE.
    const removed = this.documents.deleteDocument(docId);
    if (!removed) {
      throw new DocumentError(`No document with id "${docId}"`, 'DOCUMENT_NOT_FOUND');
    }
    this.logger.info('manage_documents', 'deleted', { docId });
    return { docId };
  }
}

module.exports = { ManageDocumentsUseCase };
