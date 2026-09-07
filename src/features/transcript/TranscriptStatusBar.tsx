import React from 'react';
import { tokens } from '../../design-system/tokens';

interface TranscriptStatusBarProps {
  isLive: boolean;
  lineCount: number;
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
}

export const TranscriptStatusBar: React.FC<TranscriptStatusBarProps> = ({
  isLive, lineCount, autoScroll, onToggleAutoScroll,
}) => (
  <div className="flex items-center justify-between px-4 py-2 shrink-0 border-b"
    style={{ borderColor: tokens.hairline }}>
    <div className="flex items-center gap-2 text-[12px]" style={{ color: tokens.mute }}>
      {isLive ? (
        <>
          <span className="w-[6px] h-[6px] rounded-full animate-pulse"
            style={{ backgroundColor: tokens.decision }} />
          <span style={{ color: tokens.decision }}>Live</span>
        </>
      ) : (
        <span>Recording ended</span>
      )}
      <span style={{ color: tokens.muteDim }}>·</span>
      <span>{lineCount} line{lineCount !== 1 ? 's' : ''}</span>
    </div>
    <button
      type="button"
      onClick={onToggleAutoScroll}
      className="text-[11px] transition-opacity ease-[cubic-bezier(.2,.8,.2,1)] hover:opacity-80 cursor-pointer font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(124,116,242,0.35)]"
      style={{ color: autoScroll ? tokens.technical : tokens.muteDim }}
      title={autoScroll ? 'Auto-scroll ON — click to pause' : 'Auto-scroll OFF — click to resume'}
    >
      {autoScroll ? '↓ Auto' : '↓ Paused'}
    </button>
  </div>
);
