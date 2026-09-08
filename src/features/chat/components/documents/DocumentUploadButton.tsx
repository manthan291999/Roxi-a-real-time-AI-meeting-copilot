import React from 'react';
import { tokens } from '../../../../design-system';

interface DocumentUploadButtonProps {
  onUpload: () => void;
  disabled?: boolean;
}

// Inline SVG — no external icon library required
const IconPaperclip = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
  </svg>
);

export const DocumentUploadButton: React.FC<DocumentUploadButtonProps> = ({ onUpload, disabled }) => {
  return (
    <button
      onClick={onUpload}
      disabled={disabled}
      className="p-2 rounded-full transition-colors flex items-center justify-center focus:outline-none disabled:opacity-50"
      style={{ color: tokens.muteDim }}
      title="Upload a PDF or TXT file"
    >
      <IconPaperclip />
    </button>
  );
};
