import React from 'react';
import { MeetingRole } from '../../../shared/types';
import { ChipPalette, SelectableChip } from '../../../design-system';

interface RolePickerProps {
  roles: MeetingRole[];
  selectedRoleId?: string;
  onSelect: (role: MeetingRole) => void;
  palette?: ChipPalette;
}

/** Single-select: choosing the selected role again clears it. */
export const RolePicker: React.FC<RolePickerProps> = ({ roles, selectedRoleId, onSelect, palette }) => (
  <div className="flex flex-wrap gap-2">
    {roles.map((role) => (
      <SelectableChip
        key={role.id}
        label={role.label}
        leading={<span aria-hidden="true">{role.emoji}</span>}
        selected={role.id === selectedRoleId}
        onClick={() => onSelect(role)}
        palette={palette}
      />
    ))}
  </div>
);
