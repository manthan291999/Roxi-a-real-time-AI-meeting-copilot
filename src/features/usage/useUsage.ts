import { useState, useEffect, useCallback, useRef } from 'react';
import { useServices } from '../../context';
import { SessionUsage } from '../../shared/types';

const POLL_MS = 10_000;

/**
 * The current capture session's LLM spend, refreshed while live.
 *
 * Polls rather than pushing an event: usage is a background/idle-curiosity
 * number, not something that needs to update mid-keystroke like a transcript
 * line, so a Tauri event + listener for it would be more plumbing than the
 * data warrants.
 */
export function useUsage(sessionId: number | null, isLive: boolean) {
  const { usageRepository } = useServices();
  const [usage, setUsage] = useState<SessionUsage | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Read inside the interval closure without retriggering the effect on
  // every fetch — only sessionId/isLive should tear down and restart polling.
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const refresh = useCallback(async () => {
    const id = sessionIdRef.current;
    if (id == null) return;
    try {
      setUsage(await usageRepository.getSessionUsage(id));
    } catch (err) {
      console.error('Failed to fetch session usage:', err);
    } finally {
      setIsLoading(false);
    }
  }, [usageRepository]);

  useEffect(() => {
    if (sessionId == null || !isLive) {
      setUsage(null);
      return;
    }
    setIsLoading(true);
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [sessionId, isLive, refresh]);

  return { usage, isLoading };
}
