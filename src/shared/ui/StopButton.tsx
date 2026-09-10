import React from 'react';

interface StopButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export const StopButton: React.FC<StopButtonProps> = ({ onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title="Stop meeting"
    className="
      flex items-center gap-1.5 rounded-full px-3 py-1
      text-[12px] font-medium
      bg-[var(--t-danger-bg)] text-[var(--t-danger)]
      hover:bg-[var(--t-danger-bg-hover)] active:enabled:scale-95
      transition-all ease-[cubic-bezier(.2,.8,.2,1)] cursor-pointer
      focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]
      disabled:opacity-40 disabled:cursor-not-allowed
    "
  >
    <span className="w-[6px] h-[6px] rounded-sm bg-[var(--t-danger)]" />
    Stop
  </button>
);
