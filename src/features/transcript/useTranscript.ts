import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import { useServices } from '../../context';
import { TxLine } from '../../shared/types';

export function useTranscript() {
  const { eventBus, speakerRepository } = useServices();
  const [lines, setLines] = useState<TxLine[]>([]);

  // PERF FIX #8: Store partials in a ref (not state) to avoid creating new object
  // references on every partial event. Partial events fire on every word the STT
  // provider recognises — the previous `setPartials(prev => ({...prev, ...}))` was
  // creating a new object on every word and forcing the whole TranscriptPane to
  // re-render. Instead we store the Map in a ref and bump a lightweight counter to
  // signal React that the partials content has changed.
  const partialsRef = useRef<Map<string, TxLine>>(new Map());
  const [partialsTick, setPartialsTick] = useState(0);

  useEffect(() => {
    const unlistenPartial = eventBus.onTranscriptPartial((line) => {
      // Keyed by sttLabel, not the display name: a rename mid-session changes
      // `speaker` and would otherwise orphan the in-flight partial.
      const prev = partialsRef.current.get(line.sttLabel);
      // Only trigger re-render when the displayed text actually changes
      if (prev?.text !== line.text) {
        partialsRef.current.set(line.sttLabel, line);
        setPartialsTick(t => t + 1);
      }
    });

    const unlistenFinal = eventBus.onTranscriptFinal((line) => {
      if (partialsRef.current.has(line.sttLabel)) {
        partialsRef.current.delete(line.sttLabel);
        setPartialsTick(t => t + 1);
      }
      setLines(prev => [...prev, line]);
    });

    return () => {
      unlistenPartial();
      unlistenFinal();
    };
  }, [eventBus]);

  // Expose a stable snapshot of partials derived from the ref
  const partials = Object.fromEntries(partialsRef.current.entries());

  // Display names live outside React (they are also written by the host), so
  // subscribe rather than mirroring them into state.
  const nameVersion = useSyncExternalStore(
    useCallback((cb) => speakerRepository.subscribe(cb), [speakerRepository]),
    () => speakerRepository.getVersion(),
    () => 0
  );

  /**
   * Resolve a display name for an STT label. A local rename (held in
   * SpeakerRepository and keyed by STT label) wins; otherwise fall back to the
   * name the gateway already resolved from speaker_names or a voice match.
   */
  const getSpeakerName = useCallback(
    (sttLabel: string, resolved?: string) => {
      const local = speakerRepository.getDisplayName(sttLabel);
      return local === sttLabel ? resolved ?? sttLabel : local;
    },
    // nameVersion participates so memoized consumers re-resolve after a rename.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [speakerRepository, nameVersion]
  );

  const renameSpeaker = useCallback(
    (sttLabel: string, displayName: string) => speakerRepository.rename(sttLabel, displayName),
    [speakerRepository]
  );

  return {
    lines,
    partials,
    getSpeakerName,
    renameSpeaker,
  };
}

