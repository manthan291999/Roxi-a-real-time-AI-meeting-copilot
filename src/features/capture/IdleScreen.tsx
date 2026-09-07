import React from 'react';
import { tokens, SignalRing } from '../../design-system';
import { StartCaptureButton } from './StartCaptureButton';
import { BlackholeNotice } from './BlackholeNotice';

interface IdleScreenProps {
  /** Opens the context intake — this screen does not start capture itself. */
  onStart: () => void;
  onHistory: () => void;
  blackholeMissing: boolean;
}

/** The ready screen shown on launch. Presentational: no services, no session state. */
export const IdleScreen: React.FC<IdleScreenProps> = ({ onStart, onHistory, blackholeMissing }) => (
  <div
    className="h-full w-full flex flex-col items-center justify-center gap-8 px-10 text-center relative"
    style={{ backgroundColor: tokens.ink }}
  >
    {/* Ambient glow behind the macro ring. */}
    <div
      className="absolute rounded-full pointer-events-none"
      style={{
        width: 240,
        height: 240,
        background: 'radial-gradient(ellipse at center, rgba(124,116,242,0.07) 0%, transparent 70%)',
      }}
    />

    <SignalRing scale="macro" />

    <div className="flex flex-col gap-3">
      <h2 className="text-[28px] font-bold tracking-tight leading-[1.25]" style={{ color: tokens.paper }}>
        Ready to capture your meeting
      </h2>
      <p className="max-w-[380px] text-[15px] leading-relaxed" style={{ color: tokens.mute }}>
        Press{' '}
        <span className="font-semibold" style={{ color: tokens.paper }}>
          Start Capture
        </span>{' '}
        to begin transcribing and interpreting your conversation in real time.
      </p>
    </div>

    <div className="flex flex-col gap-4 items-center">
      {blackholeMissing ? (
        <BlackholeNotice />
      ) : (
        <StartCaptureButton onClick={onStart} />
      )}
      
      <button
        onClick={onHistory}
        className="text-[13px] font-medium transition-colors hover:text-white"
        style={{ color: tokens.mute }}
      >
        View Past Meetings
      </button>
    </div>
  </div>
);
