import React from 'react';
import { tokens, typeScale } from '../design-system/tokens';
import { IconButton } from '../design-system/components/IconButton';
import { LiveBadge } from '../design-system/components/LiveBadge';
import { RoxiMark, RoxiWordmark } from '../design-system/components/RoxiMark';
import { ClockIcon, GearIcon, LibraryIcon } from '../design-system/icons';
import { StopButton } from '../shared/ui/StopButton';
import { Spinner } from '../shared/ui/Spinner';
import { UsagePill } from '../features/usage';
import { AppView } from '../shared/types/ui';

interface WidgetHeaderProps {
  isLive: boolean;
  isConnecting?: boolean;
  isStopping?: boolean;
  /** Current capture session id, once minted — usage is scoped to it. */
  sessionId?: number | null;
  /** Which pane is showing — the Live/Connecting pill only becomes clickable away from the session view. */
  activeView?: AppView;
  onStop: () => void;
  onHistory?: () => void;
  onLibrary?: () => void;
  onSettings?: () => void;
  /** Jumps straight back to the live session — wired to the header's Live/Connecting pill. */
  onGoLive?: () => void;
  /** Sits before the usage pill, e.g. the free-trial countdown. */
  trialBadge?: React.ReactNode;
}


export const WidgetHeader: React.FC<WidgetHeaderProps> = ({ isLive, isConnecting, isStopping, sessionId, activeView, onStop, onHistory, onLibrary, onSettings, onGoLive, trialBadge }) => {
  // The header (and this pill) stays mounted across History/Library too, so
  // clicking it from there should jump back — but not while already on the
  // session view, where it's just a status readout and there's nowhere to go.
  const canJumpToLive = activeView !== undefined && activeView !== 'session' && !!onGoLive;

  return (
    <div className="roxi-header flex items-center justify-between shrink-0" style={{ zIndex: 20, position: 'relative' }}>
      <div className="flex items-center gap-3 min-w-0">
        <RoxiMark size={26} className="shrink-0" />
        <RoxiWordmark
          className="roxi-header-title-text"
          style={{ color: tokens.paper, fontSize: typeScale.title.fontSize }}
        />
      </div>
      <div className="roxi-header-controls flex items-center shrink-0" style={{ zIndex: 20 }}>
        {(isLive || isConnecting) && (
          <>
            {isConnecting ? (
              canJumpToLive ? (
                <button
                  type="button"
                  onClick={onGoLive}
                  aria-label="Reconnecting — click to return to the session"
                  className="roxi-status-pill flex items-center gap-1.5 rounded-full px-3 py-1 border-none cursor-pointer active:scale-[0.96] transition-transform duration-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]"
                  style={{
                    backgroundColor: tokens.riskBg,
                    color: tokens.risk,
                    fontSize: typeScale.label.fontSize,
                    fontWeight: typeScale.label.fontWeight,
                  }}
                >
                  <Spinner size={12} color="orange" />
                  <span className="roxi-status-pill-label">Connecting</span>
                </button>
              ) : (
                <div
                  className="roxi-status-pill flex items-center gap-1.5 rounded-full px-3 py-1"
                  style={{
                    backgroundColor: tokens.riskBg,
                    color: tokens.risk,
                    fontSize: typeScale.label.fontSize,
                    fontWeight: typeScale.label.fontWeight,
                  }}
                >
                  <Spinner size={12} color="orange" />
                  <span className="roxi-status-pill-label">Connecting</span>
                </div>
              )
            ) : (
              <LiveBadge onClick={canJumpToLive ? onGoLive : undefined} />
            )}
            <StopButton onClick={onStop} disabled={isStopping} />
          </>
        )}
        <IconButton icon={<ClockIcon />} onClick={onHistory} label="History" />
        <IconButton icon={<LibraryIcon />} onClick={onLibrary} label="Library" />
        {trialBadge}
        <UsagePill sessionId={sessionId ?? null} isLive={isLive} />
        <IconButton icon={<GearIcon />} onClick={onSettings} label="Settings" active={activeView === 'settings'} />
      </div>
    </div>
  );
};

