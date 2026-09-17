import React from 'react';
import { tokens, typeScale } from '../tokens';

export type LiveBadgeVariant = 'live' | 'connecting';

interface LiveBadgeProps {
  variant?: LiveBadgeVariant;
  /** 'pill' is the labeled status (header, meeting card); 'dot' is a compact corner indicator for IconButton. */
  display?: 'pill' | 'dot';
  /** Renders as a button with press feedback when given; otherwise a plain status indicator. */
  onClick?: () => void;
  label?: string;
}

/**
 * Roxi's "Live"/"Connecting" indicator, shared between the meeting card in
 * History and the corner badge on the History/Library icons — both read the
 * same capture status and should jump to the same place when clicked.
 */
export const LiveBadge: React.FC<LiveBadgeProps> = ({ variant = 'live', display = 'pill', onClick, label }) => {
  const isConnecting = variant === 'connecting';
  const fg = isConnecting ? tokens.risk : tokens.decision;
  const bg = isConnecting ? tokens.riskBg : tokens.decisionBg;
  const clickable = !!onClick;

  // Stops the click from also reaching whatever this badge sits inside
  // (a meeting card, an IconButton) — the badge's own destination wins.
  const handleClick = clickable
    ? (e: React.MouseEvent) => {
        e.stopPropagation();
        onClick!();
      }
    : undefined;

  const interactiveClasses = clickable
    ? 'cursor-pointer active:scale-90 transition-transform duration-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]'
    : '';

  if (display === 'dot') {
    const Tag = (clickable ? 'button' : 'span') as React.ElementType;
    return (
      <Tag
        type={clickable ? 'button' : undefined}
        aria-label={clickable ? (label ?? `Currently ${isConnecting ? 'connecting' : 'live'} — click to return to the session`) : undefined}
        onClick={handleClick}
        className={`relative block w-[11px] h-[11px] rounded-full ${interactiveClasses}`}
      >
        {!isConnecting && (
          <span
            className="absolute inset-0 rounded-full animate-ping"
            style={{ backgroundColor: fg, opacity: 0.5 }}
          />
        )}
        <span
          className="absolute inset-0 rounded-full border-2"
          style={{ backgroundColor: fg, borderColor: 'var(--t-panel-raised)' }}
        />
      </Tag>
    );
  }

  const Tag = (clickable ? 'button' : 'div') as React.ElementType;
  return (
    <Tag
      type={clickable ? 'button' : undefined}
      onClick={handleClick}
      className={`roxi-status-pill flex items-center gap-1.5 rounded-full px-3 py-1 border-none ${interactiveClasses}`}
      style={{
        backgroundColor: bg,
        color: fg,
        fontSize: typeScale.label.fontSize,
        fontWeight: typeScale.label.fontWeight,
      }}
    >
      <span className="w-[6px] h-[6px] rounded-full animate-pulse shrink-0" style={{ backgroundColor: fg }} />
      <span className="roxi-status-pill-label">{isConnecting ? 'Connecting' : 'Live'}</span>
    </Tag>
  );
};
