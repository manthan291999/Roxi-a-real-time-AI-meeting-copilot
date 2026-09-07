import React from 'react';
import { tokens } from '../tokens';

interface SectionLabelProps {
  children: React.ReactNode;
  /** Rendered after the text, e.g. an info affordance. */
  trailing?: React.ReactNode;
}

/** The small uppercase section heading used across the dark widget panel. */
export const SectionLabel: React.FC<SectionLabelProps> = ({ children, trailing }) => (
  <div className="flex items-center gap-2">
    <span
      className="text-[11px] font-semibold uppercase tracking-widest"
      style={{ color: tokens.muteDim }}
    >
      {children}
    </span>
    {trailing}
  </div>
);
