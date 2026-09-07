import React from 'react';
import { tokens, easing } from '../tokens';

const RING_CONFIGS = {
  micro: { core: 6, rings: [10, 14, 18] },
  meso: { core: 24, rings: [32, 44, 56] },
  macro: { core: 72, rings: [96, 120, 144] },
} as const;

interface SignalRingProps {
  /** 1x (toolbar), 4x (caption), 12x (idle screen) — see the design memo. */
  scale?: keyof typeof RING_CONFIGS;
  /** Breathing halo animates when true; a dim static ring otherwise. */
  isLive?: boolean;
  /** Idle screen "ready" state — a slower, dimmer breath than `isLive`. */
  isReady?: boolean;
  /** Caption overlay uses a dimmer halo behind the transcript text. */
  dimHalo?: boolean;
  className?: string;
}

/**
 * The one motif "Roxi is listening" is remembered by — a core dot with
 * concentric breathing rings, used at three scales across the toolbar,
 * caption overlay, and idle screen so the listening state reads identically
 * everywhere. See docs/design-direction-memo.md §3.
 */
export const SignalRing: React.FC<SignalRingProps> = ({
  scale = 'micro',
  isLive = false,
  isReady = false,
  dimHalo = false,
  className = '',
}) => {
  const { core, rings } = RING_CONFIGS[scale];
  const outerSize = rings[rings.length - 1];
  // isLive wins over isReady; neither leaves the ring truly static.
  const ringAnimation = isLive ? 'signal-ring-animate' : isReady ? 'signal-ring-idle' : '';

  return (
    <div
      className={`relative flex items-center justify-center shrink-0 ${className}`}
      style={{ width: outerSize, height: outerSize }}
    >
      {rings.map((size, i) => (
        <div
          key={size}
          className={`absolute rounded-full border ${ringAnimation}`}
          style={{
            width: size,
            height: size,
            borderColor: tokens.signalLine,
            opacity: dimHalo ? 0.6 : undefined,
            animationDelay: `${i * 0.3}s`,
            transition: `opacity 0.6s ${easing.calm}`,
          }}
        />
      ))}
      <div
        className="absolute rounded-full"
        style={{
          width: core,
          height: core,
          background: tokens.signal,
          opacity: isLive ? 1 : 0.45,
          transition: `opacity 0.4s ${easing.calm}`,
        }}
      />
    </div>
  );
};
