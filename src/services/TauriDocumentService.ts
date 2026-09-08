import { invoke } from '@tauri-apps/api/core';
import { IDocumentService } from '../shared/interfaces/IDocumentService';
import { PickedFile } from '../shared/types';

/**
 * Tauri adapter for IDocumentService.
 * The ONLY file that knows the Rust command names for document operations.
 */
export class TauriDocumentService implements IDocumentService {
  async pick(): Promise<PickedFile | null> {
    // Returns null when the user cancels the dialog.
    return invoke<PickedFile | null>('pick_document');
  }

  async upload(opts: { path: string; fileName: string; docId: string }): Promise<void> {
    await invoke('upload_document', opts);
  }

  async requestList(): Promise<void> {
    await invoke('list_documents');
  }

  async remove(docId: string): Promise<void> {
    await invoke('delete_document', { docId });
  }
}
