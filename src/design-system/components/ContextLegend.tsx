import React from 'react';
import { tokens } from '../tokens';
import { MATCH_ACCENTS } from '../tagPalette';

/** Key for the accent colors ContextRow applies. */
const LEGEND_ENTRIES = [
  { label: 'Verbatim match', color: MATCH_ACCENTS.verbatim.fg },
  { label: 'Technical content', color: MATCH_ACCENTS.technical.fg },
] as const;

export const ContextLegend: React.FC = () => (
  <div className="flex items-center gap-4 pl-2">
    {LEGEND_ENTRIES.map(({ label, color }) => (
      <span key={label} className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: tokens.mute }}>
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </span>
    ))}
  </div>
);
