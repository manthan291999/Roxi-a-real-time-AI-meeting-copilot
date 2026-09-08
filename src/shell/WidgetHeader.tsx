import React, { useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { tokens } from '../design-system/tokens';
import { SparkleIcon, ClockIcon, GearIcon, LibraryIcon } from '../design-system/icons';
import { StopButton } from '../shared/ui/StopButton';
import { Spinner } from '../shared/ui/Spinner';
import { UsagePill } from '../features/usage';

interface WidgetHeaderProps {
  isLive: boolean;
  isConnecting?: boolean;
  isStopping?: boolean;
  /** Current capture session id, once minted — usage is scoped to it. */
  sessionId?: number | null;
  onStop: () => void;
  onHistory?: () => void;
  onLibrary?: () => void;
}

/** Minimal traffic-light-style window control — just hide (−). */
const WindowHideButton: React.FC = () => {
  const hide = useCallback(async () => {
    try { await getCurrentWindow().hide(); } catch (_) { /* best effort */ }
  }, []);

  return (
    <button
      type="button"
      onClick={hide}
      aria-label="Hide Roxi"
      title="Hide (Option+Space to show again)"
      className="flex items-center justify-center w-[13px] h-[13px] rounded-full shrink-0 transition-opacity hover:opacity-80 active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--t-focus-ring)] group"
      style={{ backgroundColor: '#FEBC2E', border: '0.5px solid rgba(0,0,0,0.15)' }}
    >
      {/* Show − symbol on hover, like macOS */}
      <span
        className="text-[9px] font-bold leading-none opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color: 'rgba(0,0,0,0.55)', marginTop: '-1px' }}
      >
        −
      </span>
    </button>
  );
};

export const WidgetHeader: React.FC<WidgetHeaderProps> = ({ isLive, isConnecting, isStopping, sessionId, onStop, onHistory, onLibrary }) => {
  return (
    <div className="flex items-center justify-between px-6 pt-6 pb-2 shrink-0" style={{ zIndex: 20, position: 'relative' }}>
      <div className="flex items-center gap-3">
        {/* Window hide button — sits to the left of the logo, like macOS traffic lights */}
        <WindowHideButton />
        <SparkleIcon className="w-5 h-5" />
        <span className="text-[20px] font-bold" style={{ color: tokens.paper }}>
          Roxi
        </span>
      </div>
      <div className="flex items-center gap-3.5" style={{ zIndex: 20 }}>
        {(isLive || isConnecting) && (
          <>
            {isConnecting ? (
              <div
                className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium"
                style={{ backgroundColor: tokens.riskBg, color: tokens.risk }}
              >
                <Spinner size={12} color="orange" />
                Connecting
              </div>
            ) : (
              <div
                className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium"
                style={{ backgroundColor: tokens.decisionBg, color: tokens.decision }}
              >
                <span className="w-[6px] h-[6px] rounded-full animate-pulse" style={{ backgroundColor: tokens.decision }} />
                Live
              </div>
            )}
            <StopButton onClick={onStop} disabled={isStopping} />
          </>
        )}
        <button type="button" onClick={onHistory} className="transition-opacity ease-[cubic-bezier(.2,.8,.2,1)] hover:opacity-70 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]" style={{ color: tokens.mute }} title="History">
          <ClockIcon className="w-5 h-5" />
        </button>
        <button type="button" onClick={onLibrary} className="transition-opacity ease-[cubic-bezier(.2,.8,.2,1)] hover:opacity-70 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]" style={{ color: tokens.mute }} title="Library">
          <LibraryIcon className="w-5 h-5" />
        </button>
        <UsagePill sessionId={sessionId ?? null} isLive={isLive} />
        <button type="button" className="transition-opacity ease-[cubic-bezier(.2,.8,.2,1)] hover:opacity-70 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]" style={{ color: tokens.mute }} title="Settings">
          <GearIcon className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

