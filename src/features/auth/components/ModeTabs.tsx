import React from 'react';
import { radius, tokens } from '../../../design-system';

type TabMode = 'signIn' | 'signUp';

const LABELS: Record<TabMode, string> = { signIn: 'Sign in', signUp: 'Create account' };

/** The Sign in / Create account switch. */
export const ModeTabs: React.FC<{ mode: TabMode; onChange: (mode: TabMode) => void; disabled: boolean }> = ({
  mode,
  onChange,
  disabled,
}) => (
  <div
    role="tablist"
    aria-label="Account"
    className="grid grid-cols-2 p-1 gap-1"
    style={{ borderRadius: radius.control + 2, background: tokens.overlay, border: `1px solid ${tokens.hairlineSoft}` }}
  >
    {(Object.keys(LABELS) as TabMode[]).map((m) => {
      const selected = m === mode;
      return (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={selected}
          disabled={disabled}
          onClick={() => !selected && onChange(m)}
          className="h-9 text-[13px] font-semibold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--t-focus-ring)]"
          style={{
            borderRadius: radius.control - 1,
            background: selected ? tokens.card : 'transparent',
            boxShadow: selected ? tokens.cardInset : 'none',
            color: selected ? tokens.paper : tokens.mute,
          }}
        >
          {LABELS[m]}
        </button>
      );
    })}
  </div>
);
