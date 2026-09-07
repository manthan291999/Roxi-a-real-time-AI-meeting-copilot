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
      bg-[rgba(239,68,68,0.12)] text-[#f87171]
      hover:bg-[rgba(239,68,68,0.22)]
      transition-colors ease-[cubic-bezier(.2,.8,.2,1)] cursor-pointer
      focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(124,116,242,0.35)]
      disabled:opacity-40 disabled:cursor-not-allowed
    "
  >
    <span className="w-[6px] h-[6px] rounded-sm bg-[#f87171]" />
    Stop
  </button>
);
