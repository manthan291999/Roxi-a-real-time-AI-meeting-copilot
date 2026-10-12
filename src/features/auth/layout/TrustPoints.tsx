import React from 'react';
import { brandTokens } from '../../../design-system';
import { TRUST_POINTS } from '../content/brandContent';

/** The privacy promises, one short line each. */
export const TrustPoints: React.FC = () => (
  <ul className="grid grid-cols-3 gap-4">
    {TRUST_POINTS.map(({ icon: Icon, text }) => (
      <li key={text} className="flex flex-col gap-2">
        <Icon className="w-5 h-5" style={{ color: brandTokens.accent }} />
        <span className="text-[12px] leading-snug" style={{ color: brandTokens.textMute }}>
          {text}
        </span>
      </li>
    ))}
  </ul>
);
