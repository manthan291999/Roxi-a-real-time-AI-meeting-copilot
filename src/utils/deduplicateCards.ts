import { SuggestCardType } from '../shared/types';

export function deduplicateCards(cards: SuggestCardType[], newCard: SuggestCardType): SuggestCardType[] {
  // If a card with the same ID exists, replace it, otherwise append.
  const index = cards.findIndex(c => c.id === newCard.id);
  if (index >= 0) {
    const updated = [...cards];
    updated[index] = newCard;
    return updated;
  }
  return [...cards, newCard];
}
