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

/**
 * How long an un-finalized partial may sit before it is swept.
 *
 * Sized against the STT provider's own turn detection rather than picked for
 * feel: the gateway caps a turn at STT_MAX_TURN_SILENCE (1.5s by default) plus
 * network and pipeline time, so anything still here after 8s is not a turn in
 * progress — it is a partial whose final is never coming.
 */
const PARTIAL_TTL_MS = 8_000;

/** How often to look for expired partials. Coarse on purpose: this drives a re-render. */
const PARTIAL_SWEEP_MS = 2_000;

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
  //
  // Each entry carries the time it was last updated. Consumers render the most
  // recently updated partial (Map insertion order is maintained as recency
  // order below), and PARTIAL_TTL_MS expires entries whose final never arrived —
  // see the pruning effect for why that safety net is needed.
  const partialsRef = useRef<Map<string, { line: TxLine; at: number }>>(new Map());
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

      // Empty text is the gateway explicitly retiring this partial: the turn
      // ended but produced no final (the sanitizer dropped it). Without this,
      // the entry would sit here until the TTL swept it up.
      if (line.text === '') {
        if (prev) {
          partialsRef.current.delete(line.sttLabel);
          setPartialsTick((t) => t + 1);
        }
        return;
      }

      // Compare `speaker` as well as `text`: mid-turn voice matching can resolve
      // a display name without changing a word, and skipping that update left
      // the pane showing a name the gateway had already superseded.
      if (prev?.line.text !== line.text || prev?.line.speaker !== line.speaker) {
        // Delete before set so this key moves to the end of the Map. Insertion
        // order is therefore recency order, which is what lets consumers render
        // "the partial that spoke last" rather than "whoever spoke first".
        partialsRef.current.delete(line.sttLabel);
        partialsRef.current.set(line.sttLabel, { line, at: Date.now() });
        setPartialsTick((t) => t + 1);
      }
    });

    const unlistenFinal = eventBus.onTranscriptFinal((line) => {
      if (partialsRef.current.has(line.sttLabel)) {
        partialsRef.current.delete(line.sttLabel);
        setPartialsTick((t) => t + 1);
      }
      setLines((prev) => [...prev, line]);
    });

    // The provider re-clusters voices as it hears more of the meeting and then
    // says which earlier turns it had attributed to the wrong speaker. Applying
    // these is the difference between a transcript that silently misattributes
    // its first minute and one that corrects itself.
    const unlistenRevision = eventBus.onSpeakerRevision((revisions) => {
      const byTurn = new Map(revisions.map((r) => [r.turnOrder, r.sttLabel]));
      setLines((prev) => {
        let changed = false;
        const next = prev.map((line) => {
          if (line.turnOrder === undefined) return line;
          const sttLabel = byTurn.get(line.turnOrder);
          if (sttLabel === undefined || sttLabel === line.sttLabel) return line;
          changed = true;
          // `speaker` is the display name. Re-resolve it through the repository
          // so a rename the user already made against the corrected label wins,
          // exactly as it would for a line that arrived labelled correctly.
          return { ...line, sttLabel, speaker: speakerRepository.getDisplayName(sttLabel) };
        });
        return changed ? next : prev;
      });
    });

    return () => {
      unlistenPartial();
      unlistenFinal();
      unlistenRevision();
    };
  }, [eventBus, speakerRepository]);

  // A partial is only ever cleared by a final carrying the same sttLabel, and
  // several paths never deliver one: the gateway's sanitizer discards a final
  // outright (a turn ending in "thank you", or one below the confidence floor),
  // the STT label drifts between the partial and its final as diarization
  // settles, or a provider failover swallows the in-flight turn. Any of those
  // used to wedge an entry here forever — which, combined with the pane showing
  // a single partial, is what made live transcript "sometimes" vanish.
  //
  // The gateway now retires dropped turns explicitly (empty text, above); this
  // sweep is the backstop for the paths it cannot see.
  useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Date.now() - PARTIAL_TTL_MS;
      let pruned = false;
      for (const [key, entry] of partialsRef.current) {
        if (entry.at < cutoff) {
          partialsRef.current.delete(key);
          pruned = true;
        }
      }
      if (pruned) setPartialsTick((t) => t + 1);
    }, PARTIAL_SWEEP_MS);
    return () => clearInterval(id);
  }, []);

  // Expose a stable snapshot of partials derived from the ref, in recency order.
  const partials = Object.fromEntries(
    Array.from(partialsRef.current, ([key, entry]) => [key, entry.line])
  );

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
