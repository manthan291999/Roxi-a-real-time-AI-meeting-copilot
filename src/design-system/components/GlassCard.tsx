import React, { useState } from 'react';
import { tokens, radius, elevation, durations, easing } from '../tokens';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  animateEnter?: boolean;
  /** Purely informational cards (not a hover target) can opt out of the lift. */
  interactive?: boolean;
}

/**
 * Two-layer material matching macOS vibrancy stacking: an outer blurred
 * shell plus an inner gradient vibrancy layer, rather than a single flat
 * glass surface. See docs/design-direction-memo.md's GlassCard row.
 *
 * Lifts one elevation step on hover (interactive by default) — the same
 * "raised" -> "raisedHover" step every other hoverable surface uses, so a
 * card reads as touchable rather than static.
 */
export const GlassCard: React.FC<GlassCardProps> = ({ children, className = '', animateEnter = false, interactive = true }) => {
  const [hovered, setHovered] = useState(false);
  const lifted = interactive && hovered;

  return (
    <article
      className={`relative overflow-hidden ${animateEnter ? 'animate-card-enter' : ''} ${className}`}
      onMouseEnter={interactive ? () => setHovered(true) : undefined}
      onMouseLeave={interactive ? () => setHovered(false) : undefined}
      style={{
        borderRadius: radius.card,
        background: tokens.card,
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: `1px solid ${tokens.hairline}`,
        boxShadow: lifted ? elevation.raisedHover : elevation.raised,
        transform: lifted ? 'translateY(-2px)' : 'translateY(0)',
        transition: `box-shadow ${durations.base}ms ${easing.calm}, transform ${durations.base}ms ${easing.calm}`,
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          borderRadius: radius.card,
          background: tokens.cardSheen,
        }}
      />
      <div className="relative p-4 flex flex-col gap-4">{children}</div>
    </article>
  );
};
