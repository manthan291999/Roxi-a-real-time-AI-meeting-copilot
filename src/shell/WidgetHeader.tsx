import React from 'react';
import { tokens, typeScale } from '../design-system/tokens';
import { IconButton } from '../design-system/components/IconButton';
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


export const WidgetHeader: React.FC<WidgetHeaderProps> = ({ isLive, isConnecting, isStopping, sessionId, onStop, onHistory, onLibrary }) => {
  return (
    <div className="roxi-header flex items-center justify-between shrink-0" style={{ zIndex: 20, position: 'relative' }}>
      <div className="flex items-center gap-3 min-w-0">
        <SparkleIcon className="w-5 h-5 shrink-0" />
        <span
          className="roxi-header-title-text truncate"
          style={{
            color: tokens.paper,
            fontSize: typeScale.title.fontSize,
            fontWeight: typeScale.title.fontWeight,
            letterSpacing: typeScale.title.letterSpacing,
          }}
        >
          Roxi
        </span>
      </div>
      <div className="roxi-header-controls flex items-center shrink-0" style={{ zIndex: 20 }}>
        {(isLive || isConnecting) && (
          <>
            {isConnecting ? (
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
            ) : (
              <div
                className="roxi-status-pill flex items-center gap-1.5 rounded-full px-3 py-1"
                style={{
                  backgroundColor: tokens.decisionBg,
                  color: tokens.decision,
                  fontSize: typeScale.label.fontSize,
                  fontWeight: typeScale.label.fontWeight,
                }}
              >
                <span className="w-[6px] h-[6px] rounded-full animate-pulse shrink-0" style={{ backgroundColor: tokens.decision }} />
                <span className="roxi-status-pill-label">Live</span>
              </div>
            )}
            <StopButton onClick={onStop} disabled={isStopping} />
          </>
        )}
        <IconButton icon={<ClockIcon />} onClick={onHistory} label="History" />
        <IconButton icon={<LibraryIcon />} onClick={onLibrary} label="Library" />
        <UsagePill sessionId={sessionId ?? null} isLive={isLive} />
        <IconButton icon={<GearIcon />} label="Settings" />
      </div>
    </div>
  );
};

