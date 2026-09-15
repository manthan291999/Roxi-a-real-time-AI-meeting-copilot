import React from 'react';
import { ContextItem } from '../../shared/types';
import { tokens, durations, easing } from '../tokens';
import { MATCH_ACCENTS, getMatchKind } from '../tagPalette';
import { TagChip } from './TagChip';
import { CopyButton } from './CopyButton';

interface ContextRowProps {
  item: ContextItem;
  /**
   * Takes this snippet somewhere it can be asked about. Optional, and passed
   * in rather than imported: the row must not know that "somewhere" is the
   * Ask tab, or the design system would depend on a feature.
   */
  onAsk?: (text: string) => void;
}

/**
 * One retrieved snippet: accent (dot + left bar) encodes verbatim/technical,
 * the pill encodes the category tag. Two independent signals — see ContextLegend.
 *
 * The row's actions (copy, ask) stay hidden until the row is hovered or
 * something inside it is focused. There can be several rows stacked above the
 * suggestions, and a persistent pair of buttons on each one would compete with
 * the snippet text for a glance that has to be quick. `focus-within` is what
 * keeps them reachable by keyboard despite that.
 */
export const ContextRow: React.FC<ContextRowProps> = ({ item, onAsk }) => {
  const matchKind = getMatchKind(item);
  const accent = MATCH_ACCENTS[matchKind];
  const isAccented = matchKind !== 'neutral';

  return (
    <div
      className="group/ctx flex items-start gap-2.5 rounded-lg py-1.5 pr-1.5 pl-2"
      style={{
        backgroundColor: isAccented ? accent.bg : tokens.panelRaised,
        borderLeft: `2px solid ${isAccented ? accent.fg : 'transparent'}`,
      }}
    >
      <span
        className="mt-[5px] w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: accent.fg }}
      />

      <p className="flex-1 min-w-0 text-[12px] leading-snug" style={{ color: tokens.paper }}>
        {item.text}
      </p>

      <div className="flex items-center gap-1 shrink-0">
        <span
          className="flex items-center opacity-0 group-hover/ctx:opacity-100 focus-within:opacity-100"
          style={{ transition: `opacity ${durations.fast}ms ${easing.calm}` }}
        >
          {onAsk && (
            <button
              type="button"
              onClick={() => onAsk(item.text)}
              title="Ask Roxi about this"
              aria-label="Ask Roxi about this"
              className="rounded-md px-1.5 py-1 text-[10px] font-semibold cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
              style={{ color: tokens.mute, outlineColor: tokens.focusRing }}
            >
              Ask
            </button>
          )}
          <CopyButton text={item.text} subject="this line" />
        </span>

        <span className="text-[10px] font-bold tracking-wider" style={{ color: tokens.mute }}>
          {Math.round(item.confidence * 100)}%
        </span>
        {item.tags[0] && <TagChip tag={item.tags[0]} />}
      </div>
    </div>
  );
};
