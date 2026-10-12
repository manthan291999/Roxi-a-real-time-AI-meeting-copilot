import React from 'react';
import { tokens, typeScale } from '../../../design-system';
import { passwordStrength } from '../validation';

/** Indexed by `passwordStrength().score` (0–4). */
const METER_COLORS = [tokens.danger, tokens.danger, tokens.risk, tokens.decision, tokens.decision];

export const PasswordMeter: React.FC<{ password: string }> = ({ password }) => {
  const { score, label } = passwordStrength(password);
  const color = METER_COLORS[score];
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className="h-[4px] flex-1 rounded-full transition-colors"
            style={{ backgroundColor: step <= score ? color : tokens.hairline }}
          />
        ))}
      </div>
      <span style={{ color, fontSize: typeScale.caption.fontSize, fontWeight: 600, minWidth: 64, textAlign: 'right' }}>
        {label}
      </span>
    </div>
  );
};
