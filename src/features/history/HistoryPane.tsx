import React, { useState } from 'react';
import { Meeting } from '../../shared/types';
import { useHistory } from './useHistory';
import { useMeetingDetail } from './useMeetingDetail';
import { ChatPane } from '../chat';
import { tokens, ClockIcon, ChevronLeftIcon, SparkleIcon } from '../../design-system';
import { Spinner } from '../../shared/ui/Spinner';
import { EmptyState } from '../../shared/ui/EmptyState';
import { MeetingList, HistorySelection } from './MeetingList';
import { MeetingDetailView } from './MeetingDetailView';

interface HistoryPaneProps {
  /** Whether a capture session is currently recording. */
  isLive?: boolean;
  /** Jumps back to the live session — wired to the live meeting's row. */
  onGoLive?: () => void;
}

/** Starter questions for the empty Ask Roxi thread — each one is sent as-is. */
const HISTORY_SUGGESTIONS = [
  'Summarize my most recent meeting',
  'What action items are assigned to me?',
  'What did we decide this week?',
];

/** The Ask Roxi content pane's toolbar; its Back button only shows in the one-column layout. */
const AskToolbar: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <header className="h-[52px] shrink-0 flex items-center gap-2 px-4 border-b" style={{ borderColor: tokens.hairlineSoft }}>
    <button
      type="button"
      onClick={onBack}
      aria-label="Back to meetings"
      title="Back to meetings"
      className="roxi-split-back w-7 h-7 items-center justify-center rounded-[7px] hover:bg-[var(--t-overlay-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--t-focus-ring)]"
      style={{ color: tokens.signal }}
    >
      <ChevronLeftIcon className="w-4 h-4" />
    </button>
    <SparkleIcon className="w-4 h-4 shrink-0" />
    <h2 className="shrink-0 text-[15px] font-bold tracking-[-0.01em]" style={{ color: tokens.paper }}>
      Ask Roxi
    </h2>
    <span className="truncate text-[12px]" style={{ color: tokens.mute }}>
      · Answers from all your meetings and documents
    </span>
  </header>
);

export const HistoryPane: React.FC<HistoryPaneProps> = ({ isLive = false, onGoLive }) => {
  const { meetings, loading, error } = useHistory();
  const { selectedMeeting, isLoadingDetail, openMeeting, closeMeeting } = useMeetingDetail();
  const [selection, setSelection] = useState<HistorySelection>({ kind: 'ask' });
  /** Which half the one-column layout shows; ignored while both columns fit. */
  const [narrowView, setNarrowView] = useState<'list' | 'content'>('list');

  // The gateway inserts a meeting's row the moment capture starts (before any
  // transcript exists), and get_meetings() orders by start_time DESC with only
  // one capture ever running at a time — so while live, that row is always
  // meetings[0]. There's no shared id to match against: the Rust session id
  // returned by start_capture and this row's id come from separate inserts.
  const liveMeetingId = isLive && meetings.length > 0 ? meetings[0].id : null;

  const selectAsk = () => {
    setSelection({ kind: 'ask' });
    closeMeeting();
    setNarrowView('content');
  };

  const selectMeeting = (meeting: Meeting) => {
    setSelection({ kind: 'meeting', id: meeting.id });
    openMeeting(meeting);
    setNarrowView('content');
  };

  const backToList = () => setNarrowView('list');

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  if (error) {
    return <EmptyState message={`Couldn't load your meetings: ${error}`} />;
  }

  if (meetings.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 p-8 text-center">
        <span
          aria-hidden="true"
          className="w-12 h-12 mb-2 rounded-[12px] flex items-center justify-center border"
          style={{ background: tokens.card, borderColor: tokens.hairline, color: tokens.mute }}
        >
          <ClockIcon className="w-6 h-6" />
        </span>
        <h3 className="text-[17px] font-bold" style={{ color: tokens.paper }}>No Past Meetings Yet</h3>
        <p className="max-w-[360px] text-[13px] leading-relaxed" style={{ color: tokens.mute }}>
          Every meeting you capture lands here with its transcript, decisions and action items, and Ask Roxi can
          search across all of them.
        </p>
      </div>
    );
  }

  return (
    <div className="roxi-split" data-view={narrowView}>
      <div className="roxi-split-list">
        <MeetingList
          meetings={meetings}
          selection={selection}
          liveMeetingId={liveMeetingId}
          onSelectAsk={selectAsk}
          onSelectMeeting={selectMeeting}
          onGoLive={onGoLive}
        />
      </div>

      <div className="roxi-split-content">
        {selection.kind === 'meeting' && selectedMeeting ? (
          <MeetingDetailView meeting={selectedMeeting} isLoading={isLoadingDetail} onBack={backToList} />
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <AskToolbar onBack={backToList} />
            <div className="flex-1 min-h-0">
              <ChatPane
                threadId="history"
                emptyHint="Ask Roxi about any past meeting"
                suggestions={HISTORY_SUGGESTIONS}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
