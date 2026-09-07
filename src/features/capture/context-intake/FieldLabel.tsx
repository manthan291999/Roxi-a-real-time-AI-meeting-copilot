import React from 'react';
import { tokens } from '../../../design-system';

/** The small uppercase section label above each group in the intake modal. */
export const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    className="text-[11px] font-semibold uppercase tracking-[0.12em]"
    style={{ color: tokens.muteDim }}
  >
    {children}
  </span>
);
