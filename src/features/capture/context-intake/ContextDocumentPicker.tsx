import React from 'react';
import { UploadedDocument, DocumentProgress } from '../../../shared/types';
import { tokens, radius, CheckIcon, PlusIcon } from '../../../design-system';
import { IntakeSection } from './IntakeSection';

/** How many documents one meeting can be grounded on. */
const MAX_DOCS = 3;

interface ContextDocumentPickerProps {
  step: number;
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
  </svg>
);

const IconUpload = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

export const ContextDocumentPicker: React.FC<ContextDocumentPickerProps> = ({
  step,
  documents,
  selectedDocIds,
  progressMap,
  onToggle,
  onUpload,
}) => {
  const readyDocs = documents.filter(d => d.status === 'ready');
  const processingDocs = documents.filter(d => d.status !== 'ready');
  const allDocs = [...readyDocs, ...processingDocs];

  const aside = (
    <div className="flex items-center gap-2">
      <span
        className="text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full"
        style={{
          background: selectedDocIds.length > 0 ? tokens.signalDim : tokens.panelRaised,
          color: selectedDocIds.length > 0 ? tokens.signal : tokens.muteDim,
        }}
      >
        {selectedDocIds.length}/{MAX_DOCS}
      </span>
      {allDocs.length > 0 && (
        <button
          type="button"
          onClick={onUpload}
          className="h-7 flex items-center gap-1 px-2.5 rounded-full border text-[12px] font-medium transition-colors hover:bg-[var(--t-overlay-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]"
          style={{ background: tokens.card, borderColor: tokens.hairline, color: tokens.paper }}
          title="Upload a PDF, TXT, DOCX, or MD file"
        >
          <PlusIcon className="w-3 h-3" />
          Upload
        </button>
      )}
    </div>
  );

  return (
    <IntakeSection step={step} title="Reference documents" aside={aside}>
      {allDocs.length === 0 ? (
        <button
          type="button"
          onClick={onUpload}
          className="group w-full flex items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-[var(--t-overlay-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]"
          style={{ borderRadius: radius.card, border: `1.5px dashed ${tokens.hairline}` }}
        >
          <span
            aria-hidden="true"
            className="w-9 h-9 shrink-0 rounded-[10px] flex items-center justify-center transition-transform group-hover:-translate-y-0.5"
            style={{ background: tokens.signalDim, color: tokens.signal }}
          >
            <IconUpload />
          </span>
          <span className="flex flex-col min-w-0">
            <span className="text-[13px] font-medium" style={{ color: tokens.paper }}>
              Upload a spec, agenda or brief
            </span>
            <span className="text-[12px]" style={{ color: tokens.muteDim }}>
              PDF · TXT · DOCX · MD — Roxi grounds its answers in them
            </span>
          </span>
        </button>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-[160px] overflow-y-auto custom-scrollbar pr-1">
          {allDocs.map(doc => {
            const isReady    = doc.status === 'ready';
            const isSelected = isReady && selectedDocIds.includes(doc.docId);
            const isDisabled = !isSelected && selectedDocIds.length >= MAX_DOCS;
            const progress   = progressMap[doc.docId];
            const pct        = progress?.total ? Math.round((progress.done / progress.total) * 100) : null;

            return (
              <label
                key={doc.docId}
                className={[
                  'h-10 flex items-center gap-3 px-3 border transition-colors select-none',
                  !isReady   ? 'cursor-default opacity-70' :
                  isDisabled ? 'opacity-50 cursor-not-allowed' :
                               'cursor-pointer hover:bg-[var(--t-overlay-hover)]',
                ].join(' ')}
                style={{
                  borderRadius: radius.control,
                  borderColor: isSelected ? tokens.signalLine : tokens.hairline,
                  background: isSelected ? tokens.signalDim : tokens.card,
                }}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={isSelected}
                  disabled={!isReady || isDisabled}
                  onChange={() => isReady && onToggle(doc.docId)}
                />

                {/* Checkbox indicator */}
                <span
                  aria-hidden="true"
                  className="flex items-center justify-center w-4 h-4 rounded-[5px] shrink-0 transition-colors"
                  style={{
                    border: `1px solid ${isSelected ? tokens.signal : tokens.muteDim}`,
                    background: isSelected ? tokens.signal : 'transparent',
                    color: tokens.onSignal,
                  }}
                >
                  {isSelected && <CheckIcon className="w-2.5 h-2.5" />}
                </span>

                {/* File info */}
                <span className="flex items-center gap-2 overflow-hidden flex-1 min-w-0" style={{ color: isSelected ? tokens.paper : tokens.mute }}>
                  <span className="shrink-0"><IconFileText /></span>
                  <span className="truncate text-[13px]">{doc.fileName}</span>
                </span>

                {/* Status badge */}
                {!isReady && (
                  <span className="shrink-0 flex items-center gap-1 text-[11px]" style={{ color: tokens.muteDim }}>
                    <IconSpinner />
                    {pct !== null ? `${pct}%` : 'Processing…'}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}
    </IntakeSection>
  );
};
