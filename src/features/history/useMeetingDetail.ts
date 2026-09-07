import { useState, useCallback } from 'react';
import { Meeting, MeetingDetail } from '../../shared/types';
import { useServices } from '../../context';

export function useMeetingDetail() {
  const { historyRepository } = useServices();
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const openMeeting = useCallback(async (meeting: Meeting) => {
    // Set a loading state so the modal can show a spinner while fetching details
    setIsLoadingDetail(true);
    setSelectedMeeting({ ...meeting, transcript: '', decisions: [], actionItems: [] });
    try {
      const detail = await historyRepository.getMeetingDetails(meeting.id);
      setSelectedMeeting(detail);
    } catch (err) {
      // Keep the basic meeting info but signal transcript load failure
      setSelectedMeeting({ ...meeting, transcript: null as any, decisions: [], actionItems: [] });
    } finally {
      setIsLoadingDetail(false);
    }
  }, [historyRepository]);

  const closeMeeting = useCallback(() => {
    setSelectedMeeting(null);
  }, []);

  return {
    selectedMeeting,
    isLoadingDetail,
    openMeeting,
    closeMeeting
  };
}
