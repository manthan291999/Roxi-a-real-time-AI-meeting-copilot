import React from 'react';
import { brandTokens, RoxiMark, RoxiWordmark, tokens } from '../../../design-system';

interface AuthBrandProps {
  /** `onBrand` for the dark brand panel, `light` for the form side. */
  tone?: 'light' | 'onBrand';
}

/**
 * The Roxi lockup: the Live R tile, the wordmark, and the descriptor. The
 * descriptor is here because sign-in is where a stranger first meets the
 * name; the rest of the app says just "Roxi".
 */
export const AuthBrand: React.FC<AuthBrandProps> = ({ tone = 'light' }) => (
  <div className="flex items-center gap-3 select-none">
    <RoxiMark size={40} />
    <RoxiWordmark className="text-[22px]" style={{ color: tone === 'onBrand' ? brandTokens.text : tokens.paper }} />
    <span className="text-[13px] font-medium" style={{ color: tone === 'onBrand' ? brandTokens.textMute : tokens.mute }}>
      Meeting copilot
    </span>
  </div>
);
