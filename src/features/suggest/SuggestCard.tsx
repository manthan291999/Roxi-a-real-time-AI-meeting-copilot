import React, { memo } from 'react';
import { SuggestCardType } from '../../shared/types';
import { tokens, typeScale, signatureSerif, durations, easing } from '../../design-system/tokens';
import { GlassCard } from '../../design-system/components/GlassCard';
import { CopyButton } from '../../design-system/components/CopyButton';
import { ArrowRightIcon, SparkleIcon, WarningIcon } from '../../design-system/icons';
import { formatTime } from '../../utils';
import { RefineRow } from './RefineRow';
import { currentReplyText } from './refine';

interface SuggestCardProps {
  card: SuggestCardType;
  /** Sends this reply to the Ask tab for follow-up questions. */
  onAskChat?: (question: string) => void;
  /** Rewrites this card in place. */
  onRefine?: (instruction: string, label: string) => void;
  onUndoRefine?: () => void;
  /** Label of the refinement running on THIS card, or null. */
  pendingLabel?: string | null;
  /** True while any card is refining. */
  busy?: boolean;
  /** Message from a refine that failed on this card. */
  errorMessage?: string | null;
}

// PERF FIX #9a: Wrap in memo so unchanged cards don't re-render when a new
// card is appended to the list. Without memo, every card re-renders whenever
// any card is added — O(n) DOM updates when only 1 card changed.
export const SuggestCard: React.FC<SuggestCardProps> = memo(({
  card,
  onAskChat,
  onRefine,
  onUndoRefine,
  pendingLabel = null,
  busy = false,
  errorMessage = null,
}) => {
  // Resolved lazily so Copy always takes the text the card shows RIGHT NOW —
  // a refine replaces it, and a snapshot taken at render would copy the reply
  // the user just rewrote away.
  const replyText = () => currentReplyText(card);

  const isRefining = pendingLabel !== null;

  return (
    <GlassCard className="group" animateEnter>
      <div className="flex justify-between items-start gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border uppercase"
            style={{
              color: tokens.signal,
              backgroundColor: tokens.signalDim,
              borderColor: tokens.signalLine,
              fontSize: typeScale.micro.fontSize,
              lineHeight: typeScale.micro.lineHeight,
              fontWeight: typeScale.micro.fontWeight,
              letterSpacing: typeScale.micro.letterSpacing,
            }}
          >
            Ready to say <ArrowRightIcon className="w-3 h-3" />
          </span>

          {/* Which refinement this text has been through. Without it a
              rewritten card is indistinguishable from what Roxi first said. */}
          {card.refinedWith && !isRefining && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md max-w-[190px]"
              style={{
                color: tokens.mute,
                backgroundColor: tokens.overlay,
                fontSize: typeScale.micro.fontSize,
                fontWeight: typeScale.micro.fontWeight,
              }}
              title={`Refined: ${card.refinedWith}`}
            >
              <SparkleIcon className="w-3 h-3 shrink-0" />
              <span className="truncate">{card.refinedWith}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {onAskChat && (
            <button
              type="button"
              onClick={() =>
                onAskChat(
                  `Tell me more about this suggested reply — is it the right thing to say here, and what should I be ready to back it up with?\n\n"${replyText()}"`,
                )
              }
              title="Ask Roxi about this reply"
              aria-label="Ask Roxi about this reply"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
              style={{
                color: tokens.mute,
                outlineColor: tokens.focusRing,
                fontSize: typeScale.micro.fontSize,
                fontWeight: typeScale.micro.fontWeight,
                transition: `color ${durations.fast}ms ${easing.calm}`,
              }}
            >
              Ask
            </button>
          )}
          <CopyButton text={replyText} variant="label" subject="suggested reply" />
        </div>
      </div>

      {/* The reply itself. While a refine runs the current text stays put and
          dims rather than being swapped for a skeleton: it is still the thing
          the user would say if the meeting reached them first. */}
      <div
        style={{
          opacity: isRefining ? 0.45 : 1,
          transition: `opacity ${durations.base}ms ${easing.calm}`,
        }}
      >
        {card.bullets && card.bullets.length > 0 ? (
          /* Structured bullets — LLM produced is_best metadata */
          <ul className="flex flex-col gap-1" role="list">
            {card.bullets.map((bullet, i) => (
              <li
                key={`bullet-${i}`}
                className="flex items-start gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors"
                style={bullet.isBest ? {
                  backgroundColor: tokens.bulletBestBg,
                  fontFamily: signatureSerif,
                  color: tokens.paper,
                  fontSize: typeScale.body.fontSize,
                  lineHeight: typeScale.body.lineHeight,
                } : {
                  color: tokens.paper,
                  fontSize: typeScale.body.fontSize,
                  lineHeight: typeScale.body.lineHeight,
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
          /* Prose fallback — old cache, parse miss, raw gateway path, or the
             single paragraph a refinement produces. */
          <p style={{ color: tokens.paper, fontSize: typeScale.body.fontSize, lineHeight: typeScale.body.lineHeight }}>
            {card.text}
          </p>
        )}
      </div>

      {/* Announced politely so a screen reader hears the rewrite land without
          the card stealing focus mid-meeting. */}
      <span className="sr-only" role="status" aria-live="polite">
        {isRefining ? `Rewriting: ${pendingLabel}` : ''}
      </span>

      {errorMessage && (
        <p
          className="flex items-start gap-1.5"
          style={{ color: tokens.risk, fontSize: typeScale.caption.fontSize }}
        >
          <WarningIcon className="w-3.5 h-3.5 shrink-0 mt-[1px]" />
          {errorMessage}
        </p>
      )}

      <div className="flex flex-col gap-2.5 pt-2.5 border-t" style={{ borderColor: tokens.hairlineSoft }}>
        {onRefine && (
          <RefineRow
            onRefine={onRefine}
            onUndo={card.original && onUndoRefine ? onUndoRefine : undefined}
            pendingLabel={pendingLabel}
            busy={busy}
          />
        )}

        <div className="flex justify-end items-center">
          <span
            className="font-mono"
            style={{ color: tokens.muteDim, fontSize: typeScale.caption.fontSize, fontWeight: typeScale.caption.fontWeight }}
          >
            {formatTime(card.timestamp)}
          </span>
        </div>
      </div>
    </GlassCard>
  );
});

SuggestCard.displayName = 'SuggestCard';
