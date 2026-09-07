import { useState, useCallback } from 'react';
import { Meeting } from '../../shared/types';

export function useMeetingDetail() {
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);

  const openMeeting = useCallback((meeting: Meeting) => {
    setSelectedMeeting(meeting);
  }, []);

  const closeMeeting = useCallback(() => {
    setSelectedMeeting(null);
  }, []);

  return {
    selectedMeeting,
    openMeeting,
    closeMeeting
  };
}
