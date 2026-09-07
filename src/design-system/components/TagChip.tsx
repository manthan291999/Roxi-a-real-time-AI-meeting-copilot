import React from 'react';
import { getTagColors } from '../tagPalette';

interface TagChipProps {
  tag: string;
  className?: string;
}

/** Read-only category pill. For an interactive one use SelectableChip. */
export const TagChip: React.FC<TagChipProps> = ({ tag, className = '' }) => {
  const colors = getTagColors(tag);

  return (
    <span
      className={`px-1.5 py-0.5 rounded border text-[10px] font-bold tracking-wider uppercase ${className}`}
      style={{ color: colors.fg, backgroundColor: colors.bg, borderColor: colors.border }}
    >
      {tag}
    </span>
  );
};
