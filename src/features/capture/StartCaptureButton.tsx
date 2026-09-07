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
    className="inline-flex items-center justify-center text-[15px] font-semibold tracking-[-0.01em] transition-all duration-200 ease-[cubic-bezier(.2,.8,.2,1)] hover:enabled:scale-[1.025] hover:enabled:shadow-[0_0_48px_rgba(124,116,242,0.48)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[rgba(124,116,242,0.35)] disabled:cursor-not-allowed disabled:opacity-50"
    style={{
      height: 44,
      padding: '0 24px',
      borderRadius: radius.pill,
      background: tokens.signal,
      color: '#fff',
      boxShadow: '0 0 32px rgba(124,116,242,0.3)',
    }}
  >
    Start Capture
  </button>
);
