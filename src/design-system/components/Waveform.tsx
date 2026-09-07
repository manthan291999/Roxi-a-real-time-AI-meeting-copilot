import React from 'react';
import { tokens } from '../tokens';

interface WaveformProps {
  /** `live` animates; `idle` is the static ascending glyph on the ready screen. */
  variant?: 'live' | 'idle';
  className?: string;
}

/** Ascending bar heights for the idle glyph, in px. */
const IDLE_BAR_HEIGHTS = [10, 18, 28, 38];

export const Waveform: React.FC<WaveformProps> = ({ variant = 'live', className = '' }) => {
  if (variant === 'idle') {
    return (
      <div className={`flex items-end gap-[5px] ${className}`} aria-hidden="true">
        {IDLE_BAR_HEIGHTS.map((height, index) => (
          <div
            key={index}
            className="w-[7px] rounded-full"
            style={{ height, backgroundColor: tokens.muteDim }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={`flex items-end gap-[2px] h-[14px] ${className}`} aria-hidden="true">
      {IDLE_BAR_HEIGHTS.map((_, index) => (
        <div
          key={index}
          className="w-[3px] h-full rounded-sm animate-waveform"
          style={{ backgroundColor: tokens.technical }}
        />
      ))}
    </div>
  );
};
