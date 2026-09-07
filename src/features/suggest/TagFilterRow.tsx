import React from 'react';
import { SuggestTag } from '../../shared/types';
import { AccentColors, ChipPalette, SectionLabel, SelectableChip, TAG_PALETTE } from '../../design-system';

interface TagFilterRowProps {
  selectedTags: Set<SuggestTag>;
  onToggle: (tag: SuggestTag) => void;
}

/** Outlined when off, tinted in the tag's own color when on. */
function toChipPalette(colors: AccentColors): ChipPalette {
  return {
    fg: colors.fg,
    bg: 'transparent',
    border: colors.border,
    selectedFg: colors.fg,
    selectedBg: colors.bg,
    selectedBorder: colors.border,
  };
}

/** Driven by TAG_PALETTE, so a new tag category needs no change here. */
const TAGS = Object.keys(TAG_PALETTE) as SuggestTag[];

export const TagFilterRow: React.FC<TagFilterRowProps> = ({ selectedTags, onToggle }) => (
  <section className="flex flex-col gap-2">
    <SectionLabel>Tags</SectionLabel>
    <div className="flex flex-wrap gap-2">
      {TAGS.map((tag) => (
        <SelectableChip
          key={tag}
          label={tag}
          selected={selectedTags.has(tag)}
          onClick={() => onToggle(tag)}
          palette={toChipPalette(TAG_PALETTE[tag])}
        />
      ))}
    </div>
  </section>
);
