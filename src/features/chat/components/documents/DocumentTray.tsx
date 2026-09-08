import React from 'react';
import { UploadedDocument, DocumentProgress } from '../../../../shared/types';
import { DocumentPill } from './DocumentPill';
import { tokens } from '../../../../design-system';

interface DocumentTrayProps {
  documents: UploadedDocument[];
  progressMap: Record<string, DocumentProgress>;
  onDelete: (docId: string) => void;
}

export const DocumentTray: React.FC<DocumentTrayProps> = ({ documents, progressMap, onDelete }) => {
  const activeProgressIds = Object.keys(progressMap);
  
  if (documents.length === 0 && activeProgressIds.length === 0) {
    return null;
  }

  return (
    <div 
      className="flex flex-wrap gap-2 px-4 py-2 border-t"
      style={{ 
        borderTop: `1px solid ${tokens.hairline}`,
        backgroundColor: tokens.panel
      }}
    >
      {documents.map(doc => (
        <DocumentPill 
          key={doc.docId} 
          document={doc} 
          onDelete={() => onDelete(doc.docId)} 
        />
      ))}
      {activeProgressIds.map(docId => (
        <DocumentPill 
          key={docId} 
          progress={progressMap[docId]} 
          onDelete={() => onDelete(docId)} 
        />
      ))}
    </div>
  );
};
