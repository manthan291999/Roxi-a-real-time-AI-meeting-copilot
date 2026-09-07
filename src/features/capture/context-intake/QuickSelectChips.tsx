import React from 'react';
import { MeetingPreset } from '../../../shared/types';
import { ChipPalette, SelectableChip } from '../../../design-system';

interface QuickSelectChipsProps {
  presets: MeetingPreset[];
  selectedPresetId?: string;
  onSelect: (preset: MeetingPreset) => void;
  palette?: ChipPalette;
}

export const QuickSelectChips: React.FC<QuickSelectChipsProps> = ({
  presets,
  selectedPresetId,
  onSelect,
  palette,
}) => (
  <div className="flex flex-wrap gap-2">
    {presets.map((preset) => (
      <SelectableChip
        key={preset.id}
        label={preset.label}
        selected={preset.id === selectedPresetId}
        onClick={() => onSelect(preset)}
        palette={palette}
        title={preset.description}
      />
    ))}
  </div>
);
