/**
 * Document types — mirror of chatbot sidecar stdout protocol and
 * src-tauri/src/commands/documents.rs return shapes.
 *
 * Keep in sync with:
 *   chatbot/src/application/useCases/IndexDocumentUseCase.js  (DocumentProgress phases)
 *   src-tauri/src/commands/documents.rs                        (PickResult)
 */

export type DocumentPhase = 'parse' | 'chunk' | 'embed' | 'store';
export type DocumentStatus = 'indexing' | 'ready' | 'failed';

/** Payload of the `document_progress` Tauri event. */
export interface DocumentProgress {
  docId: string;
  phase: DocumentPhase;
  done: number;
  total: number;
}

/** Payload of the `document_ready` Tauri event. */
export interface DocumentReady {
  docId: string;
  fileName: string;
  chunkCount: number;
  pageCount?: number;
  deduped: boolean;
}

/** One row in the `document_list` Tauri event. */
export interface UploadedDocument {
  docId: string;
  fileName: string;
  chunkCount: number;
  pageCount?: number;
  uploadedAt: string;
  bytes: number;
  status: DocumentStatus;
  errorMessage?: string;
}

/** Payload of the `document_deleted` Tauri event. */
export interface DocumentDeleted {
  docId: string;
}

/** Return value of invoke('pick_document'). */
export interface PickedFile {
  path: string;
  fileName: string;
  bytes: number;
}
