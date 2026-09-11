import React from 'react';
import { tokens, typeScale, VoiceWave } from '../../design-system';
import { StartCaptureButton } from './StartCaptureButton';
import { BlackholeNotice } from './BlackholeNotice';
import { CaptureErrorNotice } from './CaptureErrorNotice';

interface IdleScreenProps {
  /** Opens the context intake — this screen does not start capture itself. */
  onStart: () => void;
  onHistory: () => void;
  onLibrary: () => void;
  blackholeMissing: boolean;
  /** Set when the previous session ended on its own rather than via Stop. */
  lastError?: string | null;
}

/** The ready screen shown on launch. Presentational: no services, no session state. */
export const IdleScreen: React.FC<IdleScreenProps> = ({ onStart, onHistory, onLibrary, blackholeMissing, lastError }) => (
  <div
    className="h-full w-full flex flex-col items-center justify-center gap-8 px-10 text-center relative"
    // Transparent so the shell's glass shows through; this used to paint an
    // opaque `ink` ground over the whole idle screen.
    style={{ backgroundColor: 'transparent' }}
  >
    {/* Ambient glow behind the macro ring. */}
    <div
      className="absolute rounded-full pointer-events-none"
      style={{
        width: 240,
        height: 240,
        background: `radial-gradient(ellipse at center, ${tokens.signalDim} 0%, transparent 70%)`,
      }}
    />

    {/* Idle: no capture is running, so there is no meter to sample — the wave
        renders its own slow "ready" travel until a session starts. */}
    <div className="w-[280px] max-w-full">
      <VoiceWave isLive variant="idle" height={72} />
    </div>

    <div className="flex flex-col gap-3">
      <h2
        style={{
          color: tokens.paper,
          fontSize: typeScale.display.fontSize,
          lineHeight: typeScale.display.lineHeight,
          fontWeight: typeScale.display.fontWeight,
          letterSpacing: typeScale.display.letterSpacing,
        }}
      >
        Ready to capture your meeting
      </h2>
      <p
        className="max-w-[380px]"
        style={{ color: tokens.mute, fontSize: typeScale.body.fontSize, lineHeight: typeScale.body.lineHeight }}
      >
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
        <>
          {lastError && <CaptureErrorNotice message={lastError} />}
          <StartCaptureButton onClick={onStart} />
        </>
      )}

      <div className="flex items-center gap-4">
        <button
          onClick={onHistory}
          className="transition-colors hover:text-[var(--t-paper)]"
          style={{ color: tokens.mute, fontSize: typeScale.label.fontSize, fontWeight: typeScale.label.fontWeight }}
        >
          View Past Meetings
        </button>
        <div className="w-[1px] h-3 bg-white/20" />
        <button
          onClick={onLibrary}
          className="transition-colors hover:text-[var(--t-paper)]"
          style={{ color: tokens.mute, fontSize: typeScale.label.fontSize, fontWeight: typeScale.label.fontWeight }}
        >
          Manage Library
        </button>
      </div>
    </div>
  </div>
);
