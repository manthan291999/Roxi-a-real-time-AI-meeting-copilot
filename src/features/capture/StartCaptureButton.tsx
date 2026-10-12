import React from 'react';
import { tokens, radius } from '../../design-system';

interface StartCaptureButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

/** The primary signal-accent action shared by the ready screen and the intake modal. */
export const StartCaptureButton: React.FC<StartCaptureButtonProps> = ({ onClick, disabled = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="inline-flex items-center justify-center gap-[9px] text-[15px] font-semibold tracking-[-0.01em] transition-all duration-200 ease-[cubic-bezier(.2,.8,.2,1)] hover:enabled:brightness-110 active:enabled:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--t-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
    style={{
      height: 44,
      padding: '0 28px',
      borderRadius: radius.control,
      background: tokens.signal,
      color: tokens.onSignal,
      boxShadow: `${tokens.signalBevel}, 0 4px 16px ${tokens.signalLine}`,
    }}
  >
    {/* The record dot: reads as "capture" at a glance, the way a macOS record control does. */}
    <span aria-hidden="true" className="block w-2.5 h-2.5 rounded-full" style={{ background: tokens.onSignal }} />
    Start Capture
  </button>
);
