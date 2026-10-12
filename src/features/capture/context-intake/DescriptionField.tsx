import React from 'react';
import { tokens, radius } from '../../../design-system';

interface DescriptionFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Rendered in the composer's footer strip — the quick-select presets. */
  footer?: React.ReactNode;
}

/**
 * Description textarea and its presets in one composer card, so picking a
 * preset visibly fills the box it sits under. shrink-0: the sheet is a flex
 * column that can overflow the short window, and without it this card is the
 * item that gets squashed.
 */
export const DescriptionField: React.FC<DescriptionFieldProps> = ({ value, onChange, footer }) => (
  <div
    className="shrink-0 border overflow-hidden transition-[border-color,box-shadow] focus-within:border-[var(--t-signal-line)] focus-within:shadow-[0_0_0_4px_var(--t-signal-focus)]"
    style={{ borderRadius: radius.card, backgroundColor: tokens.card, borderColor: tokens.hairline }}
  >
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={3}
      aria-label="What is this meeting about?"
      placeholder="Goals, people, anything Roxi should listen for…"
      className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[14px] leading-relaxed outline-none placeholder:text-[var(--t-mute-dim)]"
      style={{ color: tokens.paper }}
    />
    {footer && (
      <div className="px-3 pt-2.5 pb-3 border-t" style={{ borderColor: tokens.hairlineSoft }}>
        {footer}
      </div>
    )}
  </div>
);
