import React from 'react';
import { UploadedDocument, DocumentProgress } from '../../../shared/types';
import { tokens } from '../../../design-system';
import { FieldLabel } from './FieldLabel';

interface ContextDocumentPickerProps {
  documents: UploadedDocument[];
  selectedDocIds: string[];
  progressMap: Record<string, DocumentProgress>;
  onToggle: (docId: string) => void;
  onUpload: () => Promise<void>;
}

// --- Inline SVG icons (no external deps) ---
const IconFileText = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
    <polyline points="10 9 9 9 8 9"/>
  </svg>
);

const IconUpload = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
);

const IconSpinner = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="animate-spin">
    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
  </svg>
);

const IconCheck = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

export const ContextDocumentPicker: React.FC<ContextDocumentPickerProps> = ({ 
  documents, 
  selectedDocIds, 
  progressMap,
  onToggle,
  onUpload,
}) => {
  const readyDocs = documents.filter(d => d.status === 'ready');
  const processingDocs = documents.filter(d => d.status !== 'ready');
  const allDocs = [...readyDocs, ...processingDocs];

  return (
    <section className="flex shrink-0 flex-col gap-3">
      {/* Header row: label + upload button */}
      <div className="flex items-center justify-between">
        <FieldLabel>
          Attach reference documents{' '}
          <span style={{ color: tokens.muteDim, fontWeight: 'normal' }}>(max 3)</span>
        </FieldLabel>
        <button
          type="button"
          onClick={onUpload}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all hover:opacity-80 active:scale-95"
          style={{
            backgroundColor: tokens.overlay,
            color: tokens.mute,
            border: `1px solid ${tokens.hairline}`,
          }}
          title="Upload a PDF, TXT, DOCX, or MD file"
        >
          <IconUpload />
          Upload
        </button>
      </div>

      {/* Document list */}
      {allDocs.length === 0 ? (
        <button
          type="button"
          onClick={onUpload}
          className="flex flex-col items-center justify-center gap-2 py-5 rounded-md w-full transition-all hover:opacity-80 border-dashed"
          style={{
            backgroundColor: tokens.panel,
            border: `1.5px dashed ${tokens.hairline}`,
            color: tokens.muteDim,
          }}
        >
          <IconUpload />
          <span className="text-xs">Click to upload your first document</span>
          <span className="text-[10px] opacity-60">PDF · TXT · DOCX · MD</span>
        </button>
      ) : (
        <div className="flex flex-col gap-2 max-h-[160px] overflow-y-auto custom-scrollbar pr-1">
          {allDocs.map(doc => {
            const isReady    = doc.status === 'ready';
            const isSelected = isReady && selectedDocIds.includes(doc.docId);
            const isDisabled = !isSelected && selectedDocIds.length >= 3;
            const progress   = progressMap[doc.docId];
            const pct        = progress?.total ? Math.round((progress.done / progress.total) * 100) : null;

            return (
              <label
                key={doc.docId}
                className={[
                  'flex items-center gap-3 p-2 rounded-md transition-all select-none',
                  !isReady           ? 'cursor-default opacity-70' :
                  isDisabled         ? 'opacity-50 cursor-not-allowed' :
                                       'cursor-pointer hover:bg-white/5',
                ].join(' ')}
                style={{
                  border: `1px solid ${isSelected ? tokens.signal : tokens.hairline}`,
                  backgroundColor: isSelected ? 'rgba(88, 101, 242, 0.08)' : tokens.panel,
                }}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={isSelected}
                  disabled={!isReady || isDisabled}
                  onChange={() => isReady && onToggle(doc.docId)}
                />

                {/* Checkbox indicator */}
                <div
                  className="flex items-center justify-center w-4 h-4 rounded-sm shrink-0"
                  style={{
                    border: `1px solid ${isSelected ? tokens.signal : tokens.muteDim}`,
                    backgroundColor: isSelected ? tokens.signal : 'transparent',
                  }}
                >
                  {isSelected && <IconCheck />}
                </div>

                {/* File info */}
                <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0" style={{ color: isSelected ? tokens.paper : tokens.mute }}>
                  <span className="shrink-0"><IconFileText /></span>
                  <span className="truncate text-sm">{doc.fileName}</span>
                </div>

                {/* Status badge */}
                <div className="shrink-0 ml-auto">
                  {!isReady && (
                    <span className="flex items-center gap-1 text-[10px]" style={{ color: tokens.muteDim }}>
                      <IconSpinner />
                      {pct !== null ? `${pct}%` : 'Processing…'}
                    </span>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
};

