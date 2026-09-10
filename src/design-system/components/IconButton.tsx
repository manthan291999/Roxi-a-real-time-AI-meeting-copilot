import React from 'react';

interface IconButtonProps {
  icon: React.ReactNode;
  onClick?: () => void;
  className?: string;
  label?: string;
  active?: boolean;
}

export const IconButton: React.FC<IconButtonProps> = ({ icon, onClick, className = '', label, active = false }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-all duration-[120ms] ease-[cubic-bezier(.2,.8,.2,1)] active:scale-90
        ${active
          ? 'text-[var(--t-signal)] bg-[var(--t-signal-dim)] border border-[var(--t-signal-line)]'
          : 'text-[var(--t-mute)] bg-[var(--t-panel-raised)] border border-[var(--t-hairline-soft)] hover:text-[var(--t-paper)] hover:bg-[var(--t-signal-dim)] hover:border-[var(--t-signal-line)]'}
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]
        ${className}`}
    >
      <span className="flex items-center justify-center [&_svg]:w-[15px] [&_svg]:h-[15px]">{icon}</span>
    </button>
  );
};
