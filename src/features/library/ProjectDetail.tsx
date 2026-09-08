import React from 'react';
import { Project } from '../../shared/types';
import { IDocumentService } from '../../shared/interfaces';

interface ProjectDetailProps {
  project: Project;
  documentService: IDocumentService;
}

import { useDocumentLibrary } from './useDocumentLibrary';

/**
 * Right pane rendering the details of the selected project (RAG documents, etc).
 */
export const ProjectDetail: React.FC<ProjectDetailProps> = ({ project, documentService }) => {
  const { documents, isLoading, addDocument, deleteDocument, progressMap } = useDocumentLibrary(project.id);

  return (
    <div className="flex flex-col h-full w-full p-8 overflow-y-auto custom-scrollbar">
      <header className="flex flex-col mb-8 gap-2">
        <h1 className="text-3xl font-bold tracking-tight" style={{ color: 'var(--t-paper)' }}>
          {project.name}
        </h1>
        <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--t-mute)' }}>
          <span className="font-mono bg-black/20 px-2 py-0.5 rounded">{project.code}</span>
          <span>•</span>
          <span>{project.meeting_count} meetings</span>
        </div>
        {project.description && (
          <p className="mt-4 text-sm max-w-2xl leading-relaxed" style={{ color: 'var(--t-mute)' }}>
            {project.description}
          </p>
        )}
      </header>

      <div className="flex flex-col flex-1 border-t pt-8" style={{ borderColor: 'var(--t-hairline)' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--t-paper)' }}>Knowledge Base</h2>
          <button 
            className="text-xs px-3 py-1.5 rounded-md font-medium transition-colors"
            style={{ backgroundColor: 'var(--t-signal)', color: '#fff' }}
            onClick={addDocument}
            disabled={isLoading}
          >
            Add Document
          </button>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-12 mt-4">
            <span className="text-sm" style={{ color: 'var(--t-mute)' }}>Loading documents...</span>
          </div>
        ) : (!documents || documents.length === 0) && Object.keys(progressMap).length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 mt-4 rounded-xl border border-dashed" style={{ borderColor: 'var(--t-hairline-soft)', backgroundColor: 'var(--t-panel)' }}>
            <span className="text-sm mb-2" style={{ color: 'var(--t-paper)' }}>No documents yet</span>
            <span className="text-xs text-center max-w-sm" style={{ color: 'var(--t-mute)' }}>
              Upload PDFs, Word docs, or text files to build this project's knowledge base. Roxi will use them to provide context in your meetings.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2 mt-4">
            {/* Show any currently uploading documents */}
            {Object.values(progressMap).map(prog => (
              <div key={prog.docId} className="p-3 rounded-lg border flex items-center justify-between" style={{ borderColor: 'var(--t-signal-line)', backgroundColor: 'var(--t-panel)' }}>
                <div className="flex flex-col flex-1 mr-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium" style={{ color: 'var(--t-paper)' }}>Uploading...</span>
                    <span className="text-xs" style={{ color: 'var(--t-signal)' }}>{prog.phase}</span>
                  </div>
                  <div className="w-full bg-black/20 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="h-full rounded-full transition-all duration-300"
                      style={{ backgroundColor: 'var(--t-signal)', width: `${Math.max(5, (prog.done / Math.max(1, prog.total)) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}

            {/* Show completed documents */}
            {documents.map(doc => (
              <div key={doc.docId} className="p-3 rounded-lg border flex items-center justify-between group" style={{ borderColor: 'var(--t-hairline)', backgroundColor: 'var(--t-panel)' }}>
                <div className="flex flex-col">
                  <span className="text-sm font-medium" style={{ color: 'var(--t-paper)' }}>{doc.fileName}</span>
                  <span className="text-xs" style={{ color: 'var(--t-mute)' }}>
                    {doc.status} • {(doc.bytes / 1024).toFixed(1)} KB • {doc.chunkCount} chunks
                  </span>
                </div>
                <button 
                  onClick={() => deleteDocument(doc.docId)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-black/20 text-xs transition-opacity"
                  style={{ color: 'var(--t-danger)' }}
                  aria-label="Delete document"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
