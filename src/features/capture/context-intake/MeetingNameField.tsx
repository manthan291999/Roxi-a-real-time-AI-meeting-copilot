import React from 'react';
import { tokens, radius } from '../../../design-system';

interface MeetingNameFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export const MeetingNameField: React.FC<MeetingNameFieldProps> = ({ value, onChange }) => (
  <input
    type="text"
    value={value}
    onChange={(event) => onChange(event.target.value)}
    autoFocus
    required
    maxLength={200}
    placeholder="e.g. Sprint Planning — Q3 Backend"
    aria-required="true"
    className="w-full shrink-0 border p-3 text-[15px] leading-relaxed outline-none transition-colors placeholder:text-[var(--t-mute-dim)] focus:border-[var(--t-signal-line)]"
    style={{
      borderRadius: radius.card,
      backgroundColor: tokens.panelRaised,
      borderColor: tokens.hairline,
      color: tokens.paper,
    }}
  />
);
