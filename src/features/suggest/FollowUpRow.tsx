import React from 'react';
import { tokens } from '../../design-system';
import { PlusIcon } from '../../design-system/icons';

interface FollowUpRowProps {
  /** Sends the follow-up on to the Ask tab. */
  onSelect: (prompt: string) => void;
}

/** Preset refinements. Add an entry to offer another one. */
const FOLLOW_UPS = ['Make it shorter', 'More formal'];

export const FollowUpRow: React.FC<FollowUpRowProps> = ({ onSelect }) => (
  <div className="flex flex-wrap items-center gap-2">
    {FOLLOW_UPS.map((label) => (
      <button
        key={label}
        type="button"
        onClick={() => onSelect(label)}
        className="rounded-full border px-3 py-1 text-[12px] font-medium transition-colors cursor-pointer hover:brightness-125"
        style={{ backgroundColor: '#282a2f', borderColor: 'rgba(255,255,255,0.10)', color: tokens.paper }}
      >
        {label}
      </button>
    ))}

    <button
      type="button"
      onClick={() => onSelect('')}
      className="inline-flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-[12px] font-medium transition-colors cursor-pointer hover:brightness-125"
      style={{ borderColor: 'rgba(255,255,255,0.20)', color: tokens.mute }}
      title="Write your own follow-up"
    >
      <PlusIcon className="w-3.5 h-3.5" />
      Custom
    </button>
  </div>
);
