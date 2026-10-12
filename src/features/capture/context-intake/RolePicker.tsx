import React from 'react';
import { MeetingRole } from '../../../shared/types';
import { tokens, radius, CheckIcon } from '../../../design-system';

interface RolePickerProps {
  roles: MeetingRole[];
  selectedRoleId?: string;
  onSelect: (role: MeetingRole) => void;
}

/** Single-select tiles: choosing the selected role again clears it. */
export const RolePicker: React.FC<RolePickerProps> = ({ roles, selectedRoleId, onSelect }) => (
  <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
    {roles.map((role) => {
      const selected = role.id === selectedRoleId;
      return (
        <button
          key={role.id}
          type="button"
          aria-pressed={selected}
          onClick={() => onSelect(role)}
          className="h-11 flex items-center gap-2.5 border px-3 text-left transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] hover:bg-[var(--t-overlay-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]"
          style={{
            borderRadius: radius.control,
            background: selected ? tokens.signalDim : tokens.card,
            borderColor: selected ? tokens.signalLine : tokens.hairline,
          }}
        >
          <span aria-hidden="true" className="text-[17px] leading-none">{role.emoji}</span>
          <span
            className="flex-1 truncate text-[13px] font-medium"
            style={{ color: selected ? tokens.signal : tokens.paper }}
          >
            {role.label}
          </span>
          {selected && (
            <span
              aria-hidden="true"
              className="w-4 h-4 shrink-0 rounded-full flex items-center justify-center"
              style={{ background: tokens.signal, color: tokens.onSignal }}
            >
              <CheckIcon className="w-2.5 h-2.5" />
            </span>
          )}
        </button>
      );
    })}
  </div>
);
