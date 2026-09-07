import React, { memo } from 'react';
import { TxLine } from '../../shared/types';
import { formatTime, getSpeakerColor } from '../../utils';
import { tokens } from '../../design-system';

interface TranscriptLineProps {
  line: TxLine;
  displayName: string;
  /** Omit to render the name as plain text (e.g. in read-only history). */
  onRenameSpeaker?: (sttLabel: string) => void;
}

// PERF FIX #9b: Wrap in React.memo. Partial transcript events fire on every word
// from the STT provider. Without memo, ALL transcript lines re-render on every
// word. With memo, only the line whose `line` prop actually changed will re-render.
export const TranscriptLine: React.FC<TranscriptLineProps> = memo(({ line, displayName, onRenameSpeaker }) => {
  const color = getSpeakerColor(line.speakerIdx);

  return (
    <div className={`flex gap-4 p-4 hover:bg-[var(--t-overlay-hover)] transition-colors ${line.partial ? 'opacity-70' : ''}`}>
      <div className="w-[100px] shrink-0 flex flex-col items-end gap-1 pt-[2px]">
        {onRenameSpeaker ? (
          <button
            type="button"
            onClick={() => onRenameSpeaker(line.sttLabel)}
            title={`Rename ${displayName}`}
            className="text-[13px] font-semibold truncate w-full text-right hover:underline cursor-pointer"
            style={{ color }}
          >
            {displayName}
          </button>
        ) : (
          <div className="text-[13px] font-semibold truncate w-full text-right" style={{ color }}>
            {displayName}
          </div>
        )}
        <div className="text-[13px] font-medium font-mono" style={{ color: tokens.muteDim }}>
          {formatTime(line.time)}
        </div>
      </div>
      <div className="flex-1 text-[15px] leading-relaxed font-normal" style={{ color: tokens.paper }}>
        {line.text}
        {line.partial && (
          <span className="inline-flex ml-1 gap-[2px]">
            <span className="w-1 h-1 bg-current rounded-full animate-typing-dot"></span>
            <span className="w-1 h-1 bg-current rounded-full animate-typing-dot"></span>
            <span className="w-1 h-1 bg-current rounded-full animate-typing-dot"></span>
          </span>
        )}
      </div>
    </div>
  );
});

TranscriptLine.displayName = 'TranscriptLine';
