import React from 'react';
import { tokens } from '../../design-system';

/**
 * Shown instead of the start button when the BlackHole driver is absent —
 * without it there is no system audio to capture on macOS.
 */
export const BlackholeNotice: React.FC = () => (
  <div
    className="max-w-[400px] rounded-xl border px-4 py-3.5 text-left"
    style={{
      backgroundColor: tokens.riskBg,
      borderColor: tokens.riskLine,
    }}
  >
    <h3 className="mb-1 text-[14px] font-semibold" style={{ color: tokens.risk }}>
      BlackHole not detected
    </h3>
    <p className="text-[13px] leading-relaxed" style={{ color: tokens.mute }}>
      Roxi needs BlackHole 2ch to capture system audio on macOS. Install it, then reopen the app to start capturing.
    </p>
  </div>
);
