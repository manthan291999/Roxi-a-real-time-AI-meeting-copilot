import { useRef, useCallback, useState, useEffect } from 'react';

export function useAutoScroll(deps: unknown[]) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Called on every deps change; scrolls only when auto-scroll is on
  const maybeScroll = useCallback(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [autoScroll]);

  // Effect to trigger scroll when dependencies change
  useEffect(() => {
    maybeScroll();
  }, [maybeScroll, ...deps]);

  const toggleAutoScroll = useCallback(() => setAutoScroll(v => !v), []);

  return { bottomRef, autoScroll, toggleAutoScroll };
}
