import React from 'react';
import { UploadedDocument, DocumentProgress } from '../../../../shared/types';
import { tokens } from '../../../../design-system';

interface DocumentPillProps {
  document?: UploadedDocument;
  progress?: DocumentProgress;
  onDelete: () => void;
}

// Inline SVG icons — no external icon library required
const IconFileText = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
    <polyline points="10 9 9 9 8 9"/>
  </svg>
);

const IconLoader = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
    <line x1="12" y1="2" x2="12" y2="6"/>
    <line x1="12" y1="18" x2="12" y2="22"/>
    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
    <line x1="2" y1="12" x2="6" y2="12"/>
    <line x1="18" y1="12" x2="22" y2="12"/>
    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/>
    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
  </svg>
);

const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
);

const IconX = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

export const DocumentPill: React.FC<DocumentPillProps> = ({ document, progress, onDelete }) => {
  const isUploading = !!progress;
  const fileName = document?.fileName || progress?.docId || 'Document';

  let icon = <IconFileText />;
  let statusText = '';

  if (isUploading) {
    icon = <IconLoader />;
    statusText = progress.phase === 'parse' ? 'Parsing...' :
                 progress.phase === 'chunk' ? 'Chunking...' :
                 progress.phase === 'embed' ? 'Embedding...' : 'Saving...';
  } else {
    icon = <IconCheck />;
  }

  return (
    <div
      className="text-xs px-3 py-2 rounded-md flex items-center gap-2"
      style={{ backgroundColor: tokens.panel, color: tokens.muteDim, border: `1px solid ${tokens.hairline}` }}
    >
      {icon}
      <span className="truncate max-w-[120px]" title={fileName}>
        {fileName}
      </span>
      {isUploading && (
        <div className="flex items-center gap-2 overflow-hidden flex-1" style={{ color: tokens.paper }}>
          {statusText} {progress.total > 0 ? `${Math.round((progress.done / progress.total) * 100)}%` : ''}
        </div>
      )}
      <button
        onClick={onDelete}
        className="ml-1 hover:text-red-500 transition-colors focus:outline-none"
        title="Remove document"
      >
        <IconX />
      </button>
    </div>
  );
};

