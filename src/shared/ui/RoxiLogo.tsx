import React from 'react';

export const RoxiLogo: React.FC = () => {
  return (
    <div className="flex items-center gap-2 px-2 py-1 select-none">
      <div className="text-[18px] font-bold tracking-tight bg-gradient-to-r from-[var(--t-signal)] to-[var(--t-decision)] text-transparent bg-clip-text">
        roxi<span className="opacity-80 font-light">.ai</span>
      </div>
    </div>
  );
};
