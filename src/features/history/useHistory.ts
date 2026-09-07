import { useState, useEffect } from 'react';
import { useServices } from '../../context';
import { Meeting } from '../../shared/types';

export function useHistory() {
  const { historyRepository } = useServices();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadMeetings() {
      try {
        setLoading(true);
        const data = await historyRepository.getMeetings();
        if (mounted) {
          setMeetings(data);
          setError(null);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.toString());
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadMeetings();

    return () => {
      mounted = false;
    };
  }, [historyRepository]);

  return {
    meetings,
    loading,
    error
  };
}
