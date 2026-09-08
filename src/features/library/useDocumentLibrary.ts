import { useState, useEffect, useCallback } from 'react';
import { UploadedDocument, DocumentProgress, DocumentReady, DocumentDeleted } from '../../shared/types';
import { useServices } from '../../context/useServices';

export interface UseDocumentLibraryState {
  documents: UploadedDocument[];
  isLoading: boolean;
  addDocument: () => Promise<void>;
  deleteDocument: (docId: string) => Promise<void>;
  progressMap: Record<string, DocumentProgress>;
}

export function useDocumentLibrary(projectId: number): UseDocumentLibraryState {
  const { documentService, eventBus } = useServices();
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [progressMap, setProgressMap] = useState<Record<string, DocumentProgress>>({});

  useEffect(() => {
    let cancelled = false;
    
    // Subscribe to events first so we don't miss anything while requesting the list
    const unsubs = [
      eventBus.onDocumentList((list) => {
        if (cancelled) return;
        setDocuments(list);
        setIsLoading(false);
      }),
      
      eventBus.onDocumentProgress((progress) => {
        if (cancelled) return;
        setProgressMap(prev => ({
          ...prev,
          [progress.docId]: progress
        }));
      }),
      
      eventBus.onDocumentReady((ready) => {
        if (cancelled) return;
        // The server will also emit a new document_list, so we just clear progress
        setProgressMap(prev => {
          const next = { ...prev };
          delete next[ready.docId];
          return next;
        });
      }),
      
      eventBus.onDocumentDeleted((deleted) => {
        if (cancelled) return;
        setDocuments(prev => prev.filter(d => d.docId !== deleted.docId));
      })
    ];

    // Request the initial list from the server
    setIsLoading(true);
    documentService.requestList();

    return () => {
      cancelled = true;
      unsubs.forEach(fn => fn());
    };
  }, [documentService, eventBus, projectId]);

  const addDocument = useCallback(async () => {
    try {
      const file = await documentService.pick();
      if (!file) return; // User cancelled
      
      // We generate a temp ID for the client side progress tracking
      const docId = `upload-${Date.now()}`;
      
      // Start fake progress for immediate feedback before the sidecar kicks in
      setProgressMap(prev => ({
        ...prev,
        [docId]: { docId, phase: 'parse', done: 0, total: 100 }
      }));
      
      // Send to backend
      await documentService.upload({
        path: file.path,
        fileName: file.fileName,
        docId,
      });
    } catch (error) {
      console.error("Failed to add document:", error);
    }
  }, [documentService]);

  const deleteDocument = useCallback(async (docId: string) => {
    try {
      await documentService.remove(docId);
      // We optimistically remove it here, or rely on the event
      setDocuments(prev => prev.filter(d => d.docId !== docId));
    } catch (error) {
      console.error("Failed to delete document:", error);
    }
  }, [documentService]);

  return {
    documents,
    isLoading,
    addDocument,
    deleteDocument,
    progressMap
  };
}
