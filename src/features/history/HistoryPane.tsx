import React from 'react';
import { useHistory } from './useHistory';
import { useMeetingDetail } from './useMeetingDetail';
import { ChatPane } from '../chat';
import { MeetingDetailModal } from './MeetingDetailModal';
import { tokens } from '../../design-system';
import { ClockIcon } from '../../design-system';
import { LiveBadge } from '../../design-system/components/LiveBadge';
import { Spinner } from '../../shared/ui/Spinner';
import { EmptyState } from '../../shared/ui/EmptyState';

interface HistoryPaneProps {
  /** Whether a capture session is currently recording. */
  isLive?: boolean;
  /** Jumps back to the live session — wired to the live meeting's card. */
  onGoLive?: () => void;
}

export const HistoryPane: React.FC<HistoryPaneProps> = ({ isLive = false, onGoLive }) => {
  const { meetings, loading, error } = useHistory();
  const { selectedMeeting, isLoadingDetail, openMeeting, closeMeeting } = useMeetingDetail();

  // The gateway inserts a meeting's row the moment capture starts (before any
  // transcript exists), and get_meetings() orders by start_time DESC with only
  // one capture ever running at a time — so while live, that row is always
  // meetings[0]. There's no shared id to match against: the Rust session id
  // returned by start_capture and this row's id come from separate inserts.
  const liveMeetingId = isLive && meetings.length > 0 ? meetings[0].id : null;

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  if (error) {
    return <EmptyState message={`Failed to load history: ${error}`} />;
  }

  if (meetings.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center text-[var(--t-mute)]">
        <ClockIcon className="w-12 h-12 mb-4" style={{ color: tokens.hairline }} />
        <h3 className="text-[16px] font-medium text-[var(--t-paper)] mb-2">No Past Meetings</h3>
        <p className="text-[13px]">
          Your past meetings will appear here. Start a capture session to record your first meeting.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-4 relative">
      <div className="flex-1 overflow-hidden flex flex-col rounded-xl">
        <div className="p-4 flex flex-col gap-4 overflow-y-auto custom-scrollbar h-1/2 border-b border-[var(--t-hairline-soft)]">
          <h2 className="text-[18px] font-bold text-[var(--t-paper)] mb-2 px-2">Past Meetings</h2>
          {meetings.map((meeting) => {
            const isLiveRow = meeting.id === liveMeetingId;
            return (
              <div
                key={meeting.id}
                onClick={() => (isLiveRow ? onGoLive?.() : openMeeting(meeting))}
                className="bg-[var(--t-panel-raised)] border border-[var(--t-hairline-soft)] rounded-xl p-4 hover:bg-[var(--t-overlay-hover)] transition-colors cursor-pointer"
              >
                <h3 className="text-[15px] font-medium text-[var(--t-paper)] mb-1">{meeting.title || 'Untitled Meeting'}</h3>
                {isLiveRow ? (
                  <LiveBadge onClick={() => onGoLive?.()} />
                ) : (
                  <p className="text-[12px] text-[var(--t-mute-dim)]">{new Date(meeting.date).toLocaleString()}</p>
                )}
              </div>
            );
          })}
        </div>
        <div className="h-1/2 flex flex-col relative overflow-hidden">
          <ChatPane threadId="history" emptyHint="Ask Roxi about any past meeting…" />
        </div>
      </div>
      <MeetingDetailModal meeting={selectedMeeting} onClose={closeMeeting} isLoading={isLoadingDetail} />
    </div>
  );
};
