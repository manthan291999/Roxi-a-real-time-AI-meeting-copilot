import React from 'react';
import { LiveOrb, IconButton, ExpandIcon, tokens, typeScale, durations, easing } from '../../design-system';
import { getSpeakerColor } from '../../utils';
import { TxLine } from '../../shared/types';
import { useTranscript } from '../transcript';

interface LiveStageProps {
  isLive: boolean;
  onExpandTranscript: () => void;
}

const StageLine: React.FC<{ line: TxLine; dim?: boolean }> = ({ line, dim = false }) => (
  <div
    className="flex items-baseline gap-2 min-w-0 animate-fade-in"
    style={{ opacity: dim ? 0.55 : 1, transition: `opacity ${durations.base}ms ${easing.calm}` }}
  >
    <span
      className="shrink-0"
      style={{ color: getSpeakerColor(line.speakerIdx), fontSize: typeScale.caption.fontSize, fontWeight: typeScale.caption.fontWeight }}
    >
      {line.speaker}
    </span>
    <span className="truncate" style={{ color: tokens.paper, fontSize: typeScale.label.fontSize, lineHeight: typeScale.label.lineHeight }}>
      {line.text}
      {line.partial && (
        <span className="inline-flex ml-1 gap-[2px] align-middle">
          <span className="w-1 h-1 bg-current rounded-full animate-typing-dot" />
          <span className="w-1 h-1 bg-current rounded-full animate-typing-dot" />
          <span className="w-1 h-1 bg-current rounded-full animate-typing-dot" />
        </span>
      )}
    </span>
  </div>
);

/**
 * The top banner: the "Roxi is listening" orb plus the last two lines of
 * live transcript. Deliberately just a ticker — the expand button is the
 * only way in to the full scrollable history (TranscriptPane, unchanged),
 * opened as a drawer by the parent dashboard.
 */
export const LiveStage: React.FC<LiveStageProps> = ({ isLive, onExpandTranscript }) => {
  const { lines, partials } = useTranscript();
  const activePartial = Object.values(partials)[0];
  const isSpeaking = Boolean(activePartial);

  const displayLines: { line: TxLine; dim?: boolean }[] = activePartial
    ? [
        ...(lines.length > 0 ? [{ line: lines[lines.length - 1], dim: true }] : []),
        { line: activePartial },
      ].slice(-2)
    : lines.slice(-2).map((line) => ({ line }));

  return (
    <div
      className="flex items-center gap-4 px-6 py-4 shrink-0"
      style={{ borderBottom: `1px solid ${tokens.hairline}` }}
    >
      <LiveOrb isLive={isLive} isSpeaking={isSpeaking} size={56} />

      <div className="flex-1 min-w-0 flex flex-col gap-1.5 justify-center">
        {displayLines.length > 0 ? (
          displayLines.map(({ line, dim }) => <StageLine key={line.id} line={line} dim={dim} />)
        ) : (
          <span
            className="italic"
            style={{ color: tokens.muteDim, fontSize: typeScale.label.fontSize }}
          >
            {isLive ? 'Waiting for speech...' : 'Not listening'}
          </span>
        )}
      </div>

      <IconButton icon={<ExpandIcon />} onClick={onExpandTranscript} label="Show full transcript" />
    </div>
  );
};
