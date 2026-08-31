import { useState, useEffect, useContext } from 'react';
import { ServicesContext } from '../../context/ServicesContext';
import { DbMeeting, DbMeetingDetails } from '../../types';

/**
 * @param initialMeetingId when provided (e.g. deep-link from a chat source
 * card), that meeting is selected on load instead of the most recent one.
 */
export function useHistory(initialMeetingId?: number | null) {
  const [meetings, setMeetings] = useState<DbMeeting[]>([]);
  const [selected, setSelected] = useState<DbMeeting | null>(null);
  const [details, setDetails] = useState<DbMeetingDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const services = useContext(ServicesContext);

  useEffect(() => {
    if (!services) return;
    services.historyRepo.getMeetings()
      .then((m) => {
        setMeetings(m);
        if (m.length > 0) {
          const target = initialMeetingId != null
            ? m.find((x) => x.id === initialMeetingId)
            : undefined;
          selectMeeting(target ?? m[0]);
        }
      })
      .catch(() => setMeetings([]))
      .finally(() => setLoading(false));
    // initialMeetingId is intentionally applied on mount only.
  }, [services]);

  function selectMeeting(m: DbMeeting | null) {
    if (!m) {
      setSelected(null);
      setDetails(null);
      return;
    }
    if (!services) return;
    setSelected(m);
    setLoadingDetails(true);
    services.historyRepo.getMeetingDetails(m.id)
      .then(setDetails)
      .catch(() => setDetails(null))
      .finally(() => setLoadingDetails(false));
  }

  return { meetings, selected, details, loading, loadingDetails, selectMeeting };
}
