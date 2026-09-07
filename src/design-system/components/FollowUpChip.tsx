import React from 'react';
import { tokens } from '../tokens';

interface FollowUpChipProps {
  label: string;
  /**
   * Rendered as-is. A node rather than an icon-font glyph name, so the chip
   * carries no knowledge of which icon set the app uses.
   */
  icon?: React.ReactNode;
  onClick?: () => void;
}

export const FollowUpChip: React.FC<FollowUpChipProps> = ({ label, icon, onClick }) => {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1 rounded-full border transition-colors ease-[cubic-bezier(.2,.8,.2,1)] text-[13px] flex items-center gap-1 hover:bg-[rgba(124,116,242,0.14)] hover:border-[rgba(124,116,242,0.35)]"
      style={{ borderColor: tokens.hairlineSoft, color: tokens.paper }}
    >
      {icon && <span className="flex items-center [&>svg]:w-3.5 [&>svg]:h-3.5">{icon}</span>}
      {label}
    </button>
  );
};
