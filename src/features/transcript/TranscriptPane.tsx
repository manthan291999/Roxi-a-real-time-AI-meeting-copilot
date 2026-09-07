import React, { useState } from 'react';
import { useTranscript } from './useTranscript';
import { TranscriptLine } from './TranscriptLine';
import { SpeakerRenameModal } from './SpeakerRenameModal';
import { TranscriptStatusBar } from './TranscriptStatusBar';
import { useAutoScroll } from './useAutoScroll';
import { tokens } from '../../design-system';

interface TranscriptPaneProps {
  isLive: boolean;
}

export const TranscriptPane: React.FC<TranscriptPaneProps> = ({ isLive }) => {
  const { lines, partials, getSpeakerName, renameSpeaker } = useTranscript();
  const { bottomRef, autoScroll, toggleAutoScroll } = useAutoScroll([lines, partials]);

  // The STT label currently being renamed, if any.
  const [renaming, setRenaming] = useState<string | null>(null);

  if (lines.length === 0 && Object.keys(partials).length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center italic text-[14px]" style={{ color: tokens.muteDim }}>
        <div className="w-full h-full absolute top-0 left-0 flex flex-col">
          <TranscriptStatusBar
            isLive={isLive}
            lineCount={0}
            autoScroll={autoScroll}
            onToggleAutoScroll={toggleAutoScroll}
          />
          <div className="flex-1 flex items-center justify-center">
            Waiting for speech...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative overflow-hidden" style={{ background: tokens.panel }}>
      <TranscriptStatusBar
        isLive={isLive}
        lineCount={lines.length}
        autoScroll={autoScroll}
        onToggleAutoScroll={toggleAutoScroll}
      />
      <div className="flex-1 overflow-y-auto custom-scrollbar relative">
        {lines.map((line, idx) => (
          <TranscriptLine
            key={line.id || `line-${idx}`}
            line={line}
            displayName={getSpeakerName(line.sttLabel, line.speaker)}
            onRenameSpeaker={setRenaming}
          />
        ))}

        {Object.values(partials).map((partial, idx) => (
          <TranscriptLine
            key={`partial-${idx}`}
            line={partial}
            displayName={getSpeakerName(partial.sttLabel, partial.speaker)}
          />
        ))}
        <div ref={bottomRef} className="h-4 shrink-0" />
      </div>

      {renaming && (
        <SpeakerRenameModal
          sttLabel={renaming}
          currentName={getSpeakerName(renaming)}
          onCancel={() => setRenaming(null)}
          onSubmit={(displayName) => renameSpeaker(renaming, displayName)}
        />
      )}
    </div>
  );
};
