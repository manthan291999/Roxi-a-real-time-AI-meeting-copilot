import React from 'react';
import { tokens } from '../design-system/tokens';
import { SparkleIcon, ClockIcon, GearIcon } from '../design-system/icons';
import { StopButton } from '../shared/ui/StopButton';
import { Spinner } from '../shared/ui/Spinner';

interface WidgetHeaderProps {
  isLive: boolean;
  isConnecting?: boolean;
  isStopping?: boolean;
  onStop: () => void;
  onHistory?: () => void;
}

export const WidgetHeader: React.FC<WidgetHeaderProps> = ({ isLive, isConnecting, isStopping, onStop, onHistory }) => {
  return (
    <div className="flex items-center justify-between px-6 pt-6 pb-2 shrink-0">
      <div className="flex items-center gap-2">
        <SparkleIcon className="w-5 h-5" />
        <span className="text-[20px] font-bold" style={{ color: tokens.paper }}>
          Roxi
        </span>
      </div>
      <div className="flex items-center gap-3.5 z-20">
        {(isLive || isConnecting) && (
          <>
            {isConnecting ? (
              <div
                className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium"
                style={{ backgroundColor: 'rgba(255, 165, 0, 0.15)', color: 'orange' }}
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
        <button type="button" onClick={onHistory} className="transition-opacity ease-[cubic-bezier(.2,.8,.2,1)] hover:opacity-70 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(124,116,242,0.35)]" style={{ color: tokens.mute }} title="History">
          <ClockIcon className="w-5 h-5" />
        </button>
        <button type="button" className="transition-opacity ease-[cubic-bezier(.2,.8,.2,1)] hover:opacity-70 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(124,116,242,0.35)]" style={{ color: tokens.mute }} title="Settings">
          <GearIcon className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
