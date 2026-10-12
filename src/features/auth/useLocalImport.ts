import { useCallback, useEffect, useState } from 'react';
import { useServices } from '../../context/useServices';
import { ImportProgress, LocalHistoryStats } from '../../shared/types/account';

export type ImportPhase = 'idle' | 'running' | 'done' | 'error';

/** Local history counts plus the state of an import into the workspace. */
export function useLocalImport() {
  const { accountService } = useServices();
  const [stats, setStats] = useState<LocalHistoryStats | null>(null);
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    accountService
      .getLocalHistoryStats()
      .then((s) => active && setStats(s))
      .catch(() => active && setStats({ meetings: 0, transcriptLines: 0, projects: 0 }));
    return () => {
      active = false;
    };
  }, [accountService]);

  const start = useCallback(async () => {
    setPhase('running');
    setError(null);
    setProgress(null);
    try {
      const result = await accountService.importLocalHistory(setProgress);
      setProgress(result);
      setPhase('done');
      return result;
    } catch (e) {
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'The import did not finish. Try again.');
      setPhase('error');
      return null;
    }
  }, [accountService]);

  return { stats, phase, progress, error, start };
}

/** Per-user flag so the first-run prompt shows once. localStorage can throw. */
export const importPromptKey = (userId: string) => `roxi.importPrompt.${userId}`;

export function readFlag(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeFlag(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not persisting only means the prompt may show again next launch.
  }
}
