import React, { useId } from 'react';
import { brandTokens } from '../tokens';

/**
 * The Roxi "Live R": one round-capped stroke plus the live dot, in a 100-unit
 * box. Master artwork is src/assets/brand/roxi-glyph.svg; keep them identical.
 */
const R_PATH = 'M33 24V77M33 24H53A14 14 0 0 1 53 52H33M50 52L67 77';

const Glyph: React.FC<{ stroke: string; strokeWidth?: number }> = ({ stroke, strokeWidth = 11 }) => (
  <>
    <path d={R_PATH} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="72" cy="25" r="7" style={{ fill: brandTokens.live }} />
  </>
);

interface RoxiMarkProps {
  /** Rendered width and height in px. */
  size?: number;
  /**
   * `tile`: the glyph on the indigo tile, for lockups and hero spots.
   * `glyph`: the bare glyph in currentColor, for places that already have a ground.
   */
  variant?: 'tile' | 'glyph';
  className?: string;
  style?: React.CSSProperties;
}

/** The Roxi logo mark. Decorative: pair it with the name, which carries the meaning. */
export const RoxiMark: React.FC<RoxiMarkProps> = ({ size = 40, variant = 'tile', className, style }) => {
  // useId output can hold characters url(#…) does not accept.
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  if (variant === 'glyph') {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false" className={className} style={style}>
        {/* Below 24px the stroke thickens so the R survives the pixel grid. */}
        <Glyph stroke="currentColor" strokeWidth={size < 24 ? 13 : 11} />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false" className={className} style={style}>
      <defs>
        <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: brandTokens.markTop }} />
          <stop offset="1" style={{ stopColor: brandTokens.markBottom }} />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.22" />
          <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${id}-tile)`} />
      <rect width="40" height="40" rx="11" fill={`url(#${id}-sheen)`} />
      <svg x="4" y="4" width="32" height="32" viewBox="0 0 100 100">
        <Glyph stroke="#FFFFFF" strokeWidth={size < 24 ? 13 : 11} />
      </svg>
    </svg>
  );
};

interface RoxiWordmarkProps {
  className?: string;
  style?: React.CSSProperties;
}

/**
 * "Roxi" with the live dot standing in for the dot on the i. Font size and
 * colour come from the caller. Screen readers get the plain name, not the
 * dotless-i glyph the drawing is built from.
 */
export const RoxiWordmark: React.FC<RoxiWordmarkProps> = ({ className = '', style }) => (
  <span className={`inline-flex font-semibold leading-none tracking-[-0.025em] ${className}`} style={style}>
    <span aria-hidden="true">
      Rox
      <span className="relative inline-block">
        ı
        <span
          className="absolute rounded-full"
          style={{ left: '50%', top: '0.125em', width: '0.18em', height: '0.18em', marginLeft: '-0.09em', background: brandTokens.live }}
        />
      </span>
    </span>
    <span className="sr-only">Roxi</span>
  </span>
);
