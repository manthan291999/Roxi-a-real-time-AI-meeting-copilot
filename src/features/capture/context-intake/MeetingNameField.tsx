import React from 'react';
import { tokens, radius } from '../../../design-system';

interface MeetingNameFieldProps {
  value: string;
  onChange: (value: string) => void;
}

/** The one required field, styled as the sheet's hero input. */
export const MeetingNameField: React.FC<MeetingNameFieldProps> = ({ value, onChange }) => (
  <label className="flex shrink-0 flex-col gap-1.5">
    <span className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: tokens.mute }}>
      Meeting name
      <span aria-hidden="true" className="w-[5px] h-[5px] rounded-full" style={{ background: tokens.signal }} />
    </span>
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      autoFocus
      required
      maxLength={200}
      placeholder="e.g. Sprint Planning — Q3 Backend"
      aria-required="true"
      className="w-full h-12 border px-4 text-[17px] font-medium tracking-[-0.01em] outline-none transition-[border-color,box-shadow] placeholder:font-normal placeholder:text-[var(--t-mute-dim)] focus:border-[var(--t-signal-line)] focus:shadow-[0_0_0_4px_var(--t-signal-focus)]"
      style={{
        borderRadius: radius.card,
        backgroundColor: tokens.card,
        borderColor: tokens.hairline,
        color: tokens.paper,
      }}
    />
  </label>
);
