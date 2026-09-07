import React from 'react';

interface BadgeProps {
  label: string;
  variant?: 'live' | 'connecting' | 'error' | 'neutral';
}

export const Badge: React.FC<BadgeProps> = ({ label, variant = 'neutral' }) => {
  const getVariantClasses = () => {
    switch (variant) {
      case 'live': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      case 'connecting': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      case 'error': return 'bg-red-500/10 text-red-500 border-red-500/20';
      case 'neutral':
      default: return 'bg-white/10 text-gray-300 border-white/20';
    }
  };

  const getDotColor = () => {
    switch (variant) {
      case 'live': return 'bg-emerald-500';
      case 'connecting': return 'bg-amber-500';
      case 'error': return 'bg-red-500';
      case 'neutral':
      default: return 'bg-gray-400';
    }
  };

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[12px] font-medium ${getVariantClasses()}`}>
      <div className={`w-1.5 h-1.5 rounded-full ${getDotColor()}`}></div>
      {label}
    </div>
  );
};
