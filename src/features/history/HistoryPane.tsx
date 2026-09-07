import React from 'react';
import { useHistory } from './useHistory';
import { useMeetingDetail } from './useMeetingDetail';
import { HistoryChatPane } from '../history-chat';
import { MeetingDetailModal } from './MeetingDetailModal';
import { Spinner } from '../../shared/ui/Spinner';
import { EmptyState } from '../../shared/ui/EmptyState';

export const HistoryPane: React.FC = () => {
  const { meetings, loading, error } = useHistory();
  const { selectedMeeting, openMeeting, closeMeeting } = useMeetingDetail();

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
      <div className="h-full flex flex-col items-center justify-center p-8 text-center text-[#c7c4d7]">
        <span className="material-symbols-outlined text-[48px] text-[rgba(255,255,255,0.1)] mb-4">history</span>
        <h3 className="text-[16px] font-medium text-[#e4e1ed] mb-2">No Past Meetings</h3>
        <p className="text-[13px]">
          Your past meetings will appear here. Start a capture session to record your first meeting.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-4 relative">
      <div className="flex-1 bg-[#13131b] overflow-hidden flex flex-col rounded-xl">
        <div className="p-4 flex flex-col gap-4 overflow-y-auto custom-scrollbar h-1/2 border-b border-[rgba(255,255,255,0.05)]">
          <h2 className="text-[18px] font-bold text-[#e4e1ed] mb-2 px-2">Past Meetings</h2>
          {meetings.map((meeting) => (
            <div 
              key={meeting.id}
              onClick={() => openMeeting(meeting)}
              className="bg-[#1f1f27] border border-[rgba(255,255,255,0.05)] rounded-xl p-4 hover:bg-[#292932] transition-colors cursor-pointer"
            >
              <h3 className="text-[15px] font-medium text-[#e4e1ed] mb-1">{meeting.title || 'Untitled Meeting'}</h3>
              <p className="text-[12px] text-[#464554]">{new Date(meeting.date).toLocaleString()}</p>
            </div>
          ))}
        </div>
        <div className="h-1/2 flex flex-col relative overflow-hidden">
          <HistoryChatPane />
        </div>
      </div>
      <MeetingDetailModal meeting={selectedMeeting} onClose={closeMeeting} />
    </div>
  );
};
