import React from 'react';
import { tokens, radius } from '../tokens';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  animateEnter?: boolean;
}

/**
 * Two-layer material matching macOS vibrancy stacking: an outer blurred
 * shell plus an inner gradient vibrancy layer, rather than a single flat
 * glass surface. See docs/design-direction-memo.md's GlassCard row.
 */
export const GlassCard: React.FC<GlassCardProps> = ({ children, className = '', animateEnter = false }) => {
  return (
    <article
      className={`relative overflow-hidden ${animateEnter ? 'animate-card-enter' : ''} ${className}`}
      style={{
        borderRadius: radius.card,
        background: tokens.card,
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: `1px solid ${tokens.hairline}`,
        boxShadow: tokens.cardInset,
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
