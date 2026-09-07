import React from 'react';
import { tokens } from '../tokens';

/** Colors for a chip's resting and selected states. */
export interface ChipPalette {
  fg: string;
  bg: string;
  border: string;
  selectedFg: string;
  selectedBg: string;
  selectedBorder: string;
}

/** Default palette, used by every chip in the app — idle, intake, and session. */
export const DARK_CHIP_PALETTE: ChipPalette = {
  fg: tokens.paper,
  bg: 'rgba(255, 255, 255, 0.04)',
  border: 'rgba(255, 255, 255, 0.12)',
  selectedFg: tokens.signal,
  selectedBg: tokens.signalDim,
  selectedBorder: tokens.signalLine,
};

interface SelectableChipProps {
  label: string;
  /** Rendered before the label — an emoji or a small icon. */
  leading?: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
  /** Swap in another surface's colors, e.g. PRE_SESSION_CHIP_PALETTE. */
  palette?: ChipPalette;
  title?: string;
}

/**
 * The one interactive chip in the app: quick-select presets, the role picker and
 * the tag filter row all render through this, parameterized by palette, so their
 * states stay identical across the light and dark surfaces.
 */
export const SelectableChip: React.FC<SelectableChipProps> = ({
  label,
  leading,
  selected = false,
  onClick,
  palette = DARK_CHIP_PALETTE,
  title,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={selected}
    title={title ?? label}
    className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium transition-colors ease-[cubic-bezier(.2,.8,.2,1)] cursor-pointer hover:brightness-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(124,116,242,0.35)]"
    style={{
      color: selected ? palette.selectedFg : palette.fg,
      backgroundColor: selected ? palette.selectedBg : palette.bg,
      borderColor: selected ? palette.selectedBorder : palette.border,
    }}
  >
    {leading}
    {label}
  </button>
);
