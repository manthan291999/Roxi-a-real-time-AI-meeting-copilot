import { useEffect, useRef, useState } from 'react';

/**
 * Seconds since capture started, or 0 when it is not running.
 *
 * Ticks once a second, which is the slowest cadence that still looks correct
 * on a clock. Deliberately not derived from the transcript or the session id:
 * the banner should start counting the moment the user presses Start, before
 * the sidecar has connected or said anything.
 */
export function useElapsed(isLive: boolean): number {
  const startedAt = useRef<number | null>(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!isLive) {
      startedAt.current = null;
      setSeconds(0);
      return;
    }
    startedAt.current = Date.now();
    setSeconds(0);
    const id = window.setInterval(() => {
      if (startedAt.current !== null) {
        setSeconds(Math.floor((Date.now() - startedAt.current) / 1000));
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [isLive]);

  return seconds;
}

/** `04:12`, growing to `1:04:12` only once it has to. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}
