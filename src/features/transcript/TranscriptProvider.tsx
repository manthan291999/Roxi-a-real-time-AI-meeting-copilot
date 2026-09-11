import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import { useServices } from '../../context';
import { TxLine } from '../../shared/types';

export interface TranscriptState {
  lines: TxLine[];
  partials: Record<string, TxLine>;
  getSpeakerName: (sttLabel: string, resolved?: string) => string;
  renameSpeaker: (sttLabel: string, displayName: string) => Promise<void>;
}

const TranscriptContext = createContext<TranscriptState | null>(null);

interface TranscriptProviderProps {
  children: React.ReactNode;
  /**
   * The current capture session's id, from useCaptureSession — null when no
   * session is running. A change to a new (non-null) id means a new meeting
   * has started, and is the signal to drop the previous meeting's lines: this
   * provider is mounted once for the whole app window (see below), so without
   * it a fresh capture opened straight onto the last meeting's leftover
   * transcript instead of a blank one.
   */
  sessionId: number | null;
}

/**
 * Owns the live transcript for the whole widget.
 *
 * Mounted above the tab/view switcher in App.tsx (alongside ChatThreadProvider)
 * so its event-bus subscription and accumulated lines/partials survive
 * switching to History/Library and back — panes that render this data
 * (LiveStage, TranscriptPane) mount and unmount as tabs change, so this state
 * has to live above them, same reasoning as ChatThreadProvider.
 */
export const TranscriptProvider: React.FC<TranscriptProviderProps> = ({ children, sessionId }) => {
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

  // A new session starting is the one moment a clean slate is correct: not on
  // stop (the dashboard is already hidden behind the idle screen by then, so
  // clearing there would just be invisible bookkeeping a beat early) but
  // definitely before the next meeting's own lines start arriving.
  useEffect(() => {
    if (sessionId === null) return;
    partialsRef.current.clear();
    setPartialsTick((t) => t + 1);
    setLines([]);
  }, [sessionId]);

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

  const value: TranscriptState = {
    lines,
    partials,
    getSpeakerName,
    renameSpeaker,
  };

  return <TranscriptContext.Provider value={value}>{children}</TranscriptContext.Provider>;
};

/** The live transcript. Throws if used outside the provider. */
export function useTranscriptContext(): TranscriptState {
  const ctx = useContext(TranscriptContext);
  if (!ctx) {
    throw new Error('useTranscriptContext must be used within a TranscriptProvider');
  }
  return ctx;
}
