import React, { memo } from 'react';
import { SuggestCardType } from '../../shared/types';
import { tokens } from '../../design-system/tokens';
import { GlassCard } from '../../design-system/components/GlassCard';
import { ThumbUpIcon, ThumbDownIcon, ArrowRightIcon } from '../../design-system/icons';
import { formatTime } from '../../utils';

interface SuggestCardProps {
  card: SuggestCardType;
  onThumbUp?: () => void;
  onThumbDown?: () => void;
}

// PERF FIX #9a: Wrap in memo so unchanged cards don't re-render when a new
// card is appended to the list. Without memo, every card re-renders whenever
// any card is added — O(n) DOM updates when only 1 card changed.
export const SuggestCard: React.FC<SuggestCardProps> = memo(({ card, onThumbUp, onThumbDown }) => {
  return (
    <GlassCard className="group" animateEnter>
      <div className="flex justify-between items-start">
        <span
          className="inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded-md border text-[10px] uppercase tracking-wider"
          style={{
            color: tokens.signal,
            backgroundColor: tokens.signalDim,
            borderColor: tokens.signalLine,
          }}
        >
          Ready to say <ArrowRightIcon className="w-3 h-3" />
        </span>
      </div>

      <p className="text-[14px] leading-relaxed" style={{ color: tokens.paper }}>
        {card.text}
      </p>

      <div className="flex justify-between items-center pt-2.5 border-t" style={{ borderColor: tokens.hairlineSoft }}>
        <div className="flex gap-3">
          <button
            type="button"
            aria-label="Thumbs up"
            className="transition-colors hover:text-white cursor-pointer"
            style={{ color: tokens.mute }}
            onClick={onThumbUp}
          >
            <ThumbUpIcon className="w-[18px] h-[18px]" />
          </button>
          <button
            type="button"
            aria-label="Thumbs down"
            className="transition-colors hover:text-white cursor-pointer"
            style={{ color: tokens.mute }}
            onClick={onThumbDown}
          >
            <ThumbDownIcon className="w-[18px] h-[18px]" />
          </button>
        </div>
        <span className="text-[13px] font-medium font-mono" style={{ color: tokens.muteDim }}>
          {formatTime(card.timestamp)}
        </span>
      </div>
    </GlassCard>
  );
});

SuggestCard.displayName = 'SuggestCard';
