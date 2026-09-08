import { useCallback, useEffect, useRef } from 'react';
import { useServices } from '../../context';
import { TxLine } from '../../shared/types';

const MAX_LIVE_LINES = 40;

/**
 * Bridges the gap between "just spoken" and "indexed for search": a bounded
 * rolling buffer of the most recent finalized transcript lines, independent
 * of whether the Listen tab is open. Ask Roxi needs this regardless of which
 * tab the user is on, so it subscribes to transcript events directly rather
 * than reading the `transcript` feature's `useTranscript` state — crossing
 * that feature boundary would also pull in its speaker-rename resolution,
 * which citations here don't need.
 *
 * Kept in a ref, not state: transcript finals can arrive every few seconds
 * during a live meeting, and nothing here needs to re-render on that — only
 * the snapshot taken at the moment a question is asked matters.
 */
export function useLiveTranscriptContext() {
  const { eventBus } = useServices();
  const bufferRef = useRef<TxLine[]>([]);

  useEffect(() => {
    const unlisten = eventBus.onTranscriptFinal((line) => {
      const buf = bufferRef.current;
      buf.push(line);
      if (buf.length > MAX_LIVE_LINES) buf.shift();
    });
    return unlisten;
  }, [eventBus]);

  const getSnapshot = useCallback((): string => {
    return bufferRef.current.map((l) => `${l.speaker}: ${l.text}`).join('\n');
  }, []);

  return getSnapshot;
}
