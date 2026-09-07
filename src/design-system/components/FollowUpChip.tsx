import React from 'react';
import { tokens } from '../tokens';

interface FollowUpChipProps {
  label: string;
  icon?: string;
  onClick?: () => void;
}

export const FollowUpChip: React.FC<FollowUpChipProps> = ({ label, icon, onClick }) => {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1 rounded-full border transition-colors ease-[cubic-bezier(.2,.8,.2,1)] text-[13px] flex items-center gap-1 hover:bg-[rgba(124,116,242,0.14)] hover:border-[rgba(124,116,242,0.35)]"
      style={{ borderColor: tokens.hairlineSoft, color: tokens.paper }}
    >
      {icon && <span className="material-symbols-outlined text-[14px]">{icon}</span>}
      {label}
    </button>
  );
};
