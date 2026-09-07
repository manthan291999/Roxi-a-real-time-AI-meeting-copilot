import { useState, useEffect, useRef, useCallback } from 'react';
import { useServices } from '../../context';
import { SuggestCardType } from '../../shared/types';

export function useSuggestAnswers() {
  const { eventBus } = useServices();
  const [cards, setCards] = useState<SuggestCardType[]>([]);
  // PERF FIX #7: Use a Set in a ref for O(1) duplicate detection instead of the
  // previous O(n) deduplicateCards scan over the entire cards array. Over a long
  // meeting with many suggestions, this prevents the state update from getting
  // progressively slower as the cards array grows.
  const seenIds = useRef<Set<string>>(new Set());

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

  return {
    cards,
    removeCard
  };
}

