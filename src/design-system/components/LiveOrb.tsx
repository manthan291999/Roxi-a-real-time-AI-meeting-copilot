import React from 'react';
import { tokens } from '../tokens';

interface LiveOrbProps {
  /** Session is capturing. A static, dim sphere otherwise. */
  isLive: boolean;
  /** Someone is mid-utterance right now (a partial transcript is in flight) —
   * the closest proxy to "reacting to audio" available without a real
   * amplitude signal from the capture pipeline. Pulses faster and brighter. */
  isSpeaking: boolean;
  size?: number;
}

/**
 * The "Roxi is listening" motif (see SignalRing) rendered with depth: a
 * blurred ambient glow behind an organically morphing glass sphere, instead
 * of a flat ring. Same signal color and breathing language, just built out
 * for the LiveStage banner where it reads at a glance from across the window.
 */
export const LiveOrb: React.FC<LiveOrbProps> = ({ isLive, isSpeaking, size = 64 }) => {
  const coreSize = size * 0.62;

  return (
    <div className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      <div
        className={isLive ? 'signal-ring-animate' : 'signal-ring-idle'}
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: `radial-gradient(circle at 35% 30%, ${tokens.signal}, ${tokens.technical} 70%)`,
          filter: 'blur(12px)',
        }}
      />
      <div
        className={isSpeaking ? 'live-orb-speak' : isLive ? 'live-orb-breathe' : ''}
        style={{
          width: coreSize,
          height: coreSize,
          borderRadius: '50%',
          background: `radial-gradient(circle at 32% 26%, rgba(255,255,255,0.9), ${tokens.signal} 45%, ${tokens.technical} 100%)`,
          boxShadow: `0 2px 12px ${tokens.signalLine}`,
          opacity: isLive ? 1 : 0.5,
        }}
      />
    </div>
  );
};
