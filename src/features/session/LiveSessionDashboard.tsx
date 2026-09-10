import React, { useState } from 'react';
import { tokens, radius, elevation, typeScale, IconButton, CloseIcon } from '../../design-system';
import { ChatPane } from '../chat';
import { SuggestAnswersPane } from '../suggest';
import { TranscriptPane } from '../transcript';
import { LiveStage } from './LiveStage';

interface LiveSessionDashboardProps {
  isLive: boolean;
  onAskChat: (question: string) => void;
  getLiveContext: () => string;
}

/**
 * The always-visible 3-part live view: LiveStage banner on top, "Ask Roxi"
 * and Suggested Answers side by side below. Replaces the old Suggest/Ask/
 * Listen tab switcher — nothing here is hidden behind a tab except the full
 * transcript history, which opens as a drawer over this view.
 */
export const LiveSessionDashboard: React.FC<LiveSessionDashboardProps> = ({
  isLive,
  onAskChat,
  getLiveContext,
}) => {
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative animate-fade-in">
      <LiveStage isLive={isLive} onExpandTranscript={() => setTranscriptExpanded(true)} />

      <div className="flex-1 flex flex-row overflow-hidden">
        <div className="flex-1 min-w-0 h-full" style={{ borderRight: `1px solid ${tokens.hairline}` }}>
          <ChatPane threadId="ask" getLiveContext={getLiveContext} />
        </div>
        <div className="flex-1 min-w-0 h-full overflow-y-auto custom-scrollbar p-4" style={{ background: tokens.panel }}>
          <SuggestAnswersPane onAskChat={onAskChat} />
        </div>
      </div>

      {transcriptExpanded && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--t-scrim)] backdrop-blur-sm animate-fade-in"
          onMouseDown={() => setTranscriptExpanded(false)}
          role="presentation"
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="w-[640px] h-[80%] flex flex-col overflow-hidden animate-card-enter"
            style={{
              background: tokens.sheet,
              border: `1px solid ${tokens.hairline}`,
              borderRadius: radius.card,
              boxShadow: elevation.sheet,
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Full transcript"
          >
            <div
              className="flex items-center justify-between px-4 py-3 shrink-0"
              style={{ borderBottom: `1px solid ${tokens.hairline}` }}
            >
              <span
                style={{
                  color: tokens.paper,
                  fontSize: typeScale.headline.fontSize,
                  fontWeight: typeScale.headline.fontWeight,
                }}
              >
                Full transcript
              </span>
              <IconButton icon={<CloseIcon />} onClick={() => setTranscriptExpanded(false)} label="Close" />
            </div>
            <div className="flex-1 overflow-hidden">
              <TranscriptPane isLive={isLive} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
