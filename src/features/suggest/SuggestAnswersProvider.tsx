import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useServices } from '../../context';
import { SuggestCardType } from '../../shared/types';

export interface SuggestAnswersState {
  cards: SuggestCardType[];
  removeCard: (id: string) => void;
}

const SuggestAnswersContext = createContext<SuggestAnswersState | null>(null);

interface SuggestAnswersProviderProps {
  children: React.ReactNode;
  /**
   * The current capture session's id, from useCaptureSession — null when no
   * session is running. A change to a new (non-null) id means a new meeting
   * has started, and is the signal to drop the previous meeting's cards.
   *
   * Without this, cards accumulated for one meeting were still sitting here,
   * unseen, the moment the next one started: the provider is mounted once for
   * the whole app window (see below) and had nothing telling it a new session
   * had begun, so a fresh capture opened straight onto a stranger's stale
   * "Ready to say" card from whenever the last meeting left off.
   */
  sessionId: number | null;
}

/**
 * Owns the suggested-answer cards for the whole widget.
 *
 * Mounted above the tab/view switcher in App.tsx (alongside ChatThreadProvider
 * and TranscriptProvider) so its event-bus subscription and accumulated cards
 * survive switching to History/Library and back — SuggestAnswersPane mounts
 * and unmounts as tabs change, so this state has to live above it.
 */
export const SuggestAnswersProvider: React.FC<SuggestAnswersProviderProps> = ({ children, sessionId }) => {
  const { eventBus } = useServices();
  const [cards, setCards] = useState<SuggestCardType[]>([]);
  // PERF FIX #7: Use a Set in a ref for O(1) duplicate detection instead of the
  // previous O(n) deduplicateCards scan over the entire cards array. Over a long
  // meeting with many suggestions, this prevents the state update from getting
  // progressively slower as the cards array grows.
  const seenIds = useRef<Set<string>>(new Set());

  // A new session starting is the one moment a clean slate is correct: not on
  // stop (the dashboard is already hidden behind the idle screen by then, so
  // clearing there would just be invisible bookkeeping a beat early) but
  // definitely before the next meeting's own cards start arriving.
  useEffect(() => {
    if (sessionId === null) return;
    seenIds.current.clear();
    setCards([]);
  }, [sessionId]);

  useEffect(() => {
    const unlisten = eventBus.onSuggestAnswer((card) => {
      // O(1) check — no array scan needed
      if (seenIds.current.has(card.id)) return;
      seenIds.current.add(card.id);
      setCards(prev => [...prev, card]);
    });

    return () => {
      unlisten();
    };
  }, [eventBus]);

  const removeCard = useCallback((id: string) => {
    seenIds.current.delete(id);
    setCards(prev => prev.filter(c => c.id !== id));
  }, []);

  const value: SuggestAnswersState = { cards, removeCard };

  return <SuggestAnswersContext.Provider value={value}>{children}</SuggestAnswersContext.Provider>;
};

/** The suggested-answer cards. Throws if used outside the provider. */
export function useSuggestAnswersContext(): SuggestAnswersState {
  const ctx = useContext(SuggestAnswersContext);
  if (!ctx) {
    throw new Error('useSuggestAnswersContext must be used within a SuggestAnswersProvider');
  }
  return ctx;
}
