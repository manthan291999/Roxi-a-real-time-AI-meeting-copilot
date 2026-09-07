import React from 'react';
import { tokens, radius, MemoryIcon } from '../../../design-system';

interface Props {
  nodeName: string;
}

const nodeToLabel: Record<string, string> = {
  'analyze_query': 'Understanding your question…',
  'retrieve': 'Searching your meetings…',
  'grade_documents': 'Finding the most relevant moments…',
  'clarify': 'Writing your answer…',
  'generate': 'Writing your answer…',
};

export const ThinkingIndicator: React.FC<Props> = ({ nodeName }) => {
  const label = nodeToLabel[nodeName] || (nodeName ? `Thinking (${nodeName})…` : 'Thinking…');

  return (
    <div className="flex w-full justify-start animate-fade-in">
      <div
        className="max-w-[85%] px-4 py-3 rounded-bl-sm border flex flex-col gap-2"
        style={{ 
          borderRadius: radius.card, 
          background: tokens.panelRaised, 
          borderColor: tokens.hairline 
        }}
      >
        <div className="flex items-center gap-2">
          <MemoryIcon className="w-4 h-4 animate-pulse" style={{ color: tokens.signal }} />
          <span className="text-[13px] font-medium" style={{ color: tokens.mute }}>
            {label}
          </span>
        </div>
        
        {/* Animated Shimmer Bar */}
        <div 
          className="h-1 w-full rounded-full overflow-hidden relative"
          style={{ background: 'rgba(255,255,255,0.05)' }}
        >
          <div 
            className="absolute top-0 bottom-0 left-0 w-1/3 rounded-full animate-shimmer"
            style={{ 
              background: `linear-gradient(90deg, transparent, ${tokens.signal}, transparent)` 
            }}
          />
        </div>
      </div>
    </div>
  );
};
