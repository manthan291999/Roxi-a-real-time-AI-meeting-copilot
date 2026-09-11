import React from 'react';
import { VoiceWave, IconButton, ExpandIcon, tokens, typeScale, spacing, durations, easing } from '../../design-system';
import { getSpeakerColor } from '../../utils';
import { TxLine } from '../../shared/types';
import { useTranscript } from '../transcript';
import { useAudioLevel } from '../capture';
import { useElapsed, formatElapsed } from './useElapsed';

interface LiveStageProps {
  isLive: boolean;
  onExpandTranscript: () => void;
}

/**
 * Two lines of ticker, always. The height is reserved whether or not anyone
 * has spoken, so the wave above it never shifts when the first line lands.
 */
const TICKER_MIN_HEIGHT = 38;

const StageLine: React.FC<{ line: TxLine; dim?: boolean }> = ({ line, dim = false }) => (
  <div
    className="flex items-baseline min-w-0 animate-fade-in"
    style={{ gap: spacing.sm, opacity: dim ? 0.45 : 1, transition: `opacity ${durations.base}ms ${easing.calm}` }}
  >
    <span
      className="shrink-0"
      style={{
        color: getSpeakerColor(line.speakerIdx),
        fontSize: typeScale.micro.fontSize,
        fontWeight: typeScale.micro.fontWeight,
        letterSpacing: typeScale.micro.letterSpacing,
      }}
    >
      {line.speaker}
    </span>
    <span
      className="truncate"
      style={{ color: tokens.paper, fontSize: typeScale.label.fontSize, lineHeight: typeScale.label.lineHeight, fontWeight: 400 }}
    >
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
 * The top banner: elapsed time, the live wave, and the last two lines said.
 *
 * There is deliberately no status label here. WidgetHeader already carries the
 * Live pill, and a second "LISTENING" a few centimetres below it was the same
 * fact stated twice — so that slot went to the one thing the window did not
 * show anywhere: how long this meeting has been running.
 *
 * The row reads left to right as time, sound, then a way in to the rest: the
 * elapsed clock fixes the wave's left edge at a constant x whatever the digits
 * do, the wave takes every pixel that's left, and the transcript sits beneath
 * on its own reserved height so nothing shifts when speech starts.
 */
export const LiveStage: React.FC<LiveStageProps> = ({ isLive, onExpandTranscript }) => {
  const { lines, partials } = useTranscript();
  // A getter, not a value: the level updates ~31 times a second and must not
  // re-render this subtree. VoiceWave samples it from its own frame loop.
  const readLevel = useAudioLevel();
  const elapsed = useElapsed(isLive);
  const activePartial = Object.values(partials)[0];

  const displayLines: { line: TxLine; dim?: boolean }[] = activePartial
    ? [
        ...(lines.length > 0 ? [{ line: lines[lines.length - 1], dim: true }] : []),
        { line: activePartial },
      ].slice(-2)
    : lines.slice(-2).map((line) => ({ line }));

  return (
    <div
      className="live-stage flex flex-col shrink-0"
      style={{ gap: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md, borderBottom: `1px solid ${tokens.hairline}` }}
    >
      <div className="flex items-center" style={{ gap: spacing.base }}>
        <span
          className="shrink-0 tabular-nums"
          style={{
            width: 46,
            color: isLive ? tokens.mute : tokens.muteDim,
            fontSize: typeScale.caption.fontSize,
            fontWeight: typeScale.caption.fontWeight,
            letterSpacing: typeScale.caption.letterSpacing,
            fontVariantNumeric: 'tabular-nums',
            transition: `color ${durations.base}ms ${easing.calm}`,
          }}
        >
          {formatElapsed(elapsed)}
        </span>

        <div className="flex-1 min-w-0">
          <VoiceWave isLive={isLive} sample={readLevel} height={56} />
        </div>

        <IconButton icon={<ExpandIcon />} onClick={onExpandTranscript} label="Show full transcript" />
      </div>

      <div className="flex flex-col justify-end" style={{ gap: spacing.xs, minHeight: TICKER_MIN_HEIGHT }}>
        {displayLines.length > 0 ? (
          displayLines.map(({ line, dim }) => <StageLine key={line.id} line={line} dim={dim} />)
        ) : (
          <span style={{ color: tokens.muteDim, fontSize: typeScale.label.fontSize, fontWeight: 400 }}>
            {isLive ? 'Waiting for the first words' : 'Not capturing'}
          </span>
        )}
      </div>
    </div>
  );
};
