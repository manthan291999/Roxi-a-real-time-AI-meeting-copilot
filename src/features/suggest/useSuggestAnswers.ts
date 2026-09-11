import { useSuggestAnswersContext } from './SuggestAnswersProvider';

/**
 * The suggested-answer cards, owned by SuggestAnswersProvider (mounted above
 * the tab switcher in App.tsx) so they survive switching to History/Library
 * and back.
 */
export function useSuggestAnswers() {
  return useSuggestAnswersContext();
}
