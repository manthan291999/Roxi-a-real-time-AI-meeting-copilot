import React from 'react';
import { ContextItem } from '../../shared/types';
import { tokens } from '../tokens';
import { MATCH_ACCENTS, getMatchKind } from '../tagPalette';
import { TagChip } from './TagChip';

interface ContextRowProps {
  item: ContextItem;
}

/**
 * One retrieved snippet: accent (dot + left bar) encodes verbatim/technical,
 * the pill encodes the category tag. Two independent signals — see ContextLegend.
 */
export const ContextRow: React.FC<ContextRowProps> = ({ item }) => {
  const matchKind = getMatchKind(item);
  const accent = MATCH_ACCENTS[matchKind];
  const isAccented = matchKind !== 'neutral';

  return (
    <div
      className="flex items-start gap-2.5 rounded-lg py-1.5 pr-2.5 pl-2"
      style={{
        backgroundColor: isAccented ? accent.bg : tokens.panelRaised,
        borderLeft: `2px solid ${isAccented ? accent.fg : 'transparent'}`,
      }}
    >
      <span
        className="mt-[5px] w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: accent.fg }}
      />

      <p className="flex-1 text-[12px] leading-snug" style={{ color: tokens.paper }}>
        {item.text}
      </p>

      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] font-bold tracking-wider" style={{ color: tokens.mute }}>
          {Math.round(item.confidence * 100)}%
        </span>
        {item.tags[0] && <TagChip tag={item.tags[0]} />}
      </div>
    </div>
  );
};
