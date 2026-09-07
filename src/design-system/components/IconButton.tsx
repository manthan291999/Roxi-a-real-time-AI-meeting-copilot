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
      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-all duration-[120ms] ease-[cubic-bezier(.2,.8,.2,1)]
        ${active
          ? 'text-[#7C74F2] bg-[rgba(124,116,242,0.14)] border border-[rgba(124,116,242,0.35)]'
          : 'text-[#9A9AA4] bg-[#17171D] border border-[#1B1B20] hover:text-[#F5F5F7] hover:bg-[rgba(124,116,242,0.14)] hover:border-[rgba(124,116,242,0.35)]'}
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(124,116,242,0.35)]
        ${className}`}
    >
      <span className="flex items-center justify-center [&_svg]:w-[15px] [&_svg]:h-[15px]">{icon}</span>
    </button>
  );
};
