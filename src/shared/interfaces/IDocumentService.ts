import { PickedFile, UploadedDocument } from '../types';

/**
 * Port: document lifecycle from the UI's perspective.
 *
 * Implementors: TauriDocumentService (production), FakeDocumentService (tests).
 * Caller: useDocumentLibrary only — no component imports this interface directly.
 */
export interface IDocumentService {
  /**
   * Open the native OS file picker.
   * Returns the chosen file, or null if the user cancelled.
   */
  pick(): Promise<PickedFile | null>;

  /**
   * Forward an upload to the chatbot sidecar.
   * Progress events arrive asynchronously via IEventBus.onDocumentProgress.
   */
  upload(opts: { path: string; fileName: string; docId: string }): Promise<void>;

  /** Request the current document list. Response arrives via IEventBus.onDocumentList. */
  requestList(): Promise<void>;

  /** Delete a document by id. Confirmation arrives via IEventBus.onDocumentDeleted. */
  remove(docId: string): Promise<void>;
}
