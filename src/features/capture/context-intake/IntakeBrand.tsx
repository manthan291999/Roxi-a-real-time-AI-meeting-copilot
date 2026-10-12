import React from 'react';
import { tokens, SparkleIcon, CloseIcon } from '../../../design-system';

interface IntakeBrandProps {
  onClose: () => void;
}

/** Header row for the intake sheet: the same sparkle lockup as the app header, plus a close control. */
export const IntakeBrand: React.FC<IntakeBrandProps> = ({ onClose }) => (
  <div className="flex items-center justify-between select-none">
    <div className="flex items-center gap-2">
      <SparkleIcon className="w-[18px] h-[18px]" style={{ color: tokens.signal }} />
      <span className="text-[17px] font-bold tracking-tight" style={{ color: tokens.paper }}>
        Roxi
      </span>
    </div>
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className="w-8 h-8 flex items-center justify-center rounded-full border transition-colors hover:bg-[var(--t-overlay-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]"
      style={{ borderColor: tokens.hairline, background: tokens.card, color: tokens.mute }}
    >
      <CloseIcon className="w-3.5 h-3.5" />
    </button>
  </div>
);
