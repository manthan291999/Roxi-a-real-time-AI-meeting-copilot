import React from 'react';
import { tokens, radius } from '../../../design-system';

interface DescriptionFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export const DescriptionField: React.FC<DescriptionFieldProps> = ({ value, onChange }) => (
  <textarea
    value={value}
    onChange={(event) => onChange(event.target.value)}
    rows={4}
    autoFocus
    placeholder="e.g. Sprint planning for Q3 backend migration..."
    /* shrink-0: the modal is a flex column that can overflow the short window,
       and without this the textarea is the item that gets squashed to one line. */
    className="w-full shrink-0 resize-none border p-4 text-[15px] leading-relaxed outline-none transition-colors placeholder:text-[var(--t-mute-dim)] focus:border-[var(--t-signal-line)]"
    style={{
      borderRadius: radius.card,
      backgroundColor: tokens.panelRaised,
      borderColor: tokens.hairline,
      color: tokens.paper,
    }}
  />
);
