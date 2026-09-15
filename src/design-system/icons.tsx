import React from 'react';

type IconProps = { className?: string; style?: React.CSSProperties };

export const SparkleIcon: React.FC<IconProps> = ({ className = '', style }) => (
  <svg viewBox="0 0 24 24" fill="url(#roxi-sparkle-gradient)" className={className} style={style}>
    <defs>
      <linearGradient id="roxi-sparkle-gradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="var(--t-signal)" />
        <stop offset="100%" stopColor="var(--t-technical)" />
      </linearGradient>
    </defs>
    <path d="M12 2c.6 3.8 2.2 5.4 6 6-3.8.6-5.4 2.2-6 6-.6-3.8-2.2-5.4-6-6 3.8-.6 5.4-2.2 6-6Z" />
    <path d="M19 14c.3 1.6.9 2.2 2.5 2.5-1.6.3-2.2.9-2.5 2.5-.3-1.6-.9-2.2-2.5-2.5 1.6-.3 2.2-.9 2.5-2.5Z" />
  </svg>
);

export const ClockIcon: React.FC<IconProps> = ({ className = '', style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const GearIcon: React.FC<IconProps> = ({ className = '', style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v2.4M12 18.1v2.4M20.5 12h-2.4M5.9 12H3.5M17.7 6.3l-1.7 1.7M8 16l-1.7 1.7M17.7 17.7 16 16M8 8 6.3 6.3" />
  </svg>
);

export const ThumbUpIcon: React.FC<IconProps & { filled?: boolean }> = ({ className = '', style, filled }) => (
  <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3Zm0 0 4.5-7.5a1.8 1.8 0 0 1 3.24 1.5L13.5 9H18a2 2 0 0 1 1.94 2.5l-1.6 6.4A2.5 2.5 0 0 1 15.9 20H10a3 3 0 0 1-3-3v-6Z" />
  </svg>
);

export const ThumbDownIcon: React.FC<IconProps & { filled?: boolean }> = ({ className = '', style, filled }) => (
  <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <path d="M17 13V4h3a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-3Zm0 0-4.5 7.5a1.8 1.8 0 0 1-3.24-1.5L10.5 15H6a2 2 0 0 1-1.94-2.5l1.6-6.4A2.5 2.5 0 0 1 8.1 4H14a3 3 0 0 1 3 3v6Z" />
  </svg>
);

export const ArrowRightIcon: React.FC<IconProps> = ({ className = '', style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const InfoIcon: React.FC<IconProps> = ({ className = '', style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.2M12 8.3v.1" />
  </svg>
);

export const PlusIcon: React.FC<IconProps> = ({ className = '', style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const SendIcon: React.FC<IconProps> = ({ className = '', style }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style}>
    <path d="M3.4 20.6 21 12 3.4 3.4 3 10l12 2-12 2z" />
  </svg>
);

export const CloseIcon: React.FC<IconProps> = ({ className = '', style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const SubtitlesIcon: React.FC<IconProps> = ({ className = '', style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <rect x="3" y="6" width="18" height="12" rx="2.5" />
    <path d="M6.5 13.5h4M12.5 13.5h5M6.5 10h11" />
  </svg>
);

/**
 * Disclosure chevron. Points down at rest; rotate 180deg for the open state
 * rather than swapping in a second icon.
 */
export const ChevronDownIcon: React.FC<IconProps> = ({ className = '', style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <path d="M6 9.5l6 6 6-6" />
  </svg>
);

/** Processing / compute. Used by the chat thinking indicator. */
export const MemoryIcon: React.FC<IconProps> = ({ className = '', style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <rect x="7.5" y="7.5" width="9" height="9" rx="1.6" />
    <path d="M10.2 3.4v4.1M13.8 3.4v4.1M10.2 16.5v4.1M13.8 16.5v4.1M3.4 10.2h4.1M3.4 13.8h4.1M16.5 10.2h4.1M16.5 13.8h4.1" />
  </svg>
);

/** A confirmed decision. */
export const VerifiedIcon: React.FC<IconProps> = ({ className = '', style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.4 12.3l2.5 2.5 4.7-5" />
  </svg>
);

/** An action item. */
export const AssignmentIcon: React.FC<IconProps> = ({ className = '', style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <path d="M9 5.2H7.3A1.8 1.8 0 0 0 5.5 7v12.2A1.8 1.8 0 0 0 7.3 21h9.4a1.8 1.8 0 0 0 1.8-1.8V7a1.8 1.8 0 0 0-1.8-1.8H15" />
    <rect x="9" y="3" width="6" height="4.2" rx="1.3" />
    <path d="M8.9 12h6.2M8.9 15.6h4.2" />
  </svg>
);

/** A risk. */
export const WarningIcon: React.FC<IconProps> = ({ className = '', style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <path d="M12 4.4 3.1 19.2h17.8L12 4.4Z" />
    <path d="M12 10.2v4.1M12 16.7v.1" />
  </svg>
);

export const ExpandIcon: React.FC<IconProps> = ({ className = '', style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <path d="M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5" />
  </svg>
);

export const LibraryIcon: React.FC<IconProps> = ({ className = '', style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-0-5H20" />
  </svg>
);

/** LLM spend. Used by the usage pill. */
export const CoinIcon: React.FC<IconProps> = ({ className = '', style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v8M9.5 9.8c0-1.2 1.1-1.8 2.5-1.8s2.5.7 2.5 1.7-1 1.4-2.5 1.6-2.5.6-2.5 1.7 1.1 1.8 2.5 1.8 2.5-.6 2.5-1.8" />
  </svg>
);

export const CopyIcon: React.FC<IconProps> = ({ className = '', style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5.5 15H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 4h8A1.5 1.5 0 0 1 14.5 5.5V6" />
  </svg>
);

export const CheckIcon: React.FC<IconProps> = ({ className = '', style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <path d="M5 12.5 10 17.5 19 7" />
  </svg>
);
