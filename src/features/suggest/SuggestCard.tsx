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

      {card.bullets && card.bullets.length > 0 ? (
        /* Structured bullets — LLM produced is_best metadata */
        <ul className="flex flex-col gap-1 mt-1" role="list">
          {card.bullets.map((bullet, i) => (
            <li
              key={`bullet-${i}`}
              className="flex items-start gap-2.5 text-[14px] leading-relaxed rounded-lg px-2.5 py-1.5 transition-colors"
              style={bullet.isBest ? {
                backgroundColor: tokens.bulletBestBg,
                fontFamily: '"New York", "Georgia", ui-serif, serif',
                color: tokens.paper,
              } : {
                color: tokens.paper,
              }}
            >
              {/* Bullet marker: star for best, dot for others */}
              {bullet.isBest ? (
                <span
                  className="mt-[3px] shrink-0 text-[11px] leading-none"
                  style={{ color: tokens.bulletBestDot }}
                  aria-label="Best suggestion"
                >
                  ★
                </span>
              ) : (
                <span
                  className="mt-[7px] shrink-0 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: tokens.muteDim }}
                />
              )}
              <span>{bullet.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        /* Prose fallback — old cache, parse miss, or raw gateway path */
        <p className="text-[14px] leading-relaxed" style={{ color: tokens.paper }}>
          {card.text}
        </p>
      )}

      <div className="flex justify-between items-center pt-2.5 border-t" style={{ borderColor: tokens.hairlineSoft }}>
        <div className="flex gap-3">
          <button
            type="button"
            aria-label="Thumbs up"
            className="transition-colors hover:text-[var(--t-paper)] cursor-pointer"
            style={{ color: tokens.mute }}
            onClick={onThumbUp}
          >
            <ThumbUpIcon className="w-[18px] h-[18px]" />
          </button>
          <button
            type="button"
            aria-label="Thumbs down"
            className="transition-colors hover:text-[var(--t-paper)] cursor-pointer"
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
