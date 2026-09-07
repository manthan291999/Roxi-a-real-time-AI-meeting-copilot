import { useCallback, useMemo, useState } from 'react';
import { SuggestCardType, SuggestTag } from '../../shared/types';

export type SuggestScope = 'latest' | 'all';

/** A card matches when any of its context items carries a selected tag. */
function matchesTags(card: SuggestCardType, tags: Set<SuggestTag>): boolean {
  if (tags.size === 0) return true;
  return card.contextItems.some((item) => item.tags.some((tag) => tags.has(tag)));
}

/**
 * Decides which suggestions are visible. Kept out of the pane so the pane only
 * composes, and so the scope/tag rules are testable on their own.
 */
export function useSuggestFilters(cards: SuggestCardType[]) {
  const [scope, setScope] = useState<SuggestScope>('latest');
  const [selectedTags, setSelectedTags] = useState<Set<SuggestTag>>(new Set());

  const toggleTag = useCallback((tag: SuggestTag) => {
    setSelectedTags((previous) => {
      const next = new Set(previous);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  /**
   * Cards arrive appended (see deduplicateCards), so the newest is last —
   * "Latest" is the tail, and "All" reads newest-first.
   */
  const visibleCards = useMemo(() => {
    const matching = cards.filter((card) => matchesTags(card, selectedTags));
    if (scope === 'latest') return matching.slice(-1);
    return [...matching].reverse();
  }, [cards, scope, selectedTags]);

  return {
    scope,
    setScope,
    selectedTags,
    toggleTag,
    visibleCards,
    /** Whose context is shown below the cards. */
    primaryCard: visibleCards[0],
    hasTagFilter: selectedTags.size > 0,
  };
}
