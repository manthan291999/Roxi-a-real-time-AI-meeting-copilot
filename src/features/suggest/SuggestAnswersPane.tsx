import React, { useCallback } from 'react';
import { SectionLabel, tokens } from '../../design-system';
import { useSuggestAnswers } from './useSuggestAnswers';
import { useSuggestFilters } from './useSuggestFilters';
import { SuggestCard } from './SuggestCard';
import { SuggestFilterToggle } from './SuggestFilterToggle';
import { ContextSection } from './ContextSection';
import { EmptySuggestState } from './EmptySuggestState';

interface SuggestAnswersPaneProps {
  onAskChat: (question: string) => void;
}

/**
 * Composition only: the visibility rules live in useSuggestFilters and the
 * refine round-trip lives in SuggestAnswersProvider.
 *
 * Context is read BEFORE the suggestions — what Roxi matched in the meeting
 * comes first, what it suggests you say comes second. The tag filter row is
 * deliberately not rendered (see TagFilterRow.tsx); useSuggestFilters still
 * owns the tag rules, so re-adding the row is one line here.
 *
 * The refinement chips sit on each CARD rather than once under the pane. As a
 * single pane-level row they had no way to say which suggestion they meant
 * once "All" showed more than one, and they forwarded the label to the Ask tab
 * as a question — so "Make it shorter" produced a chat message about the reply
 * instead of a shorter reply.
 */
export const SuggestAnswersPane: React.FC<SuggestAnswersPaneProps> = ({ onAskChat }) => {
  const { cards, refining, refineError, refineCard, undoRefine } = useSuggestAnswers();
  const { scope, setScope, visibleCards, primaryCard } = useSuggestFilters(cards);

  /**
   * onAskChat SENDS the question (App.tsx's askAndFocusChat), it does not
   * prefill a composer — so the snippet has to be wrapped in a question that
   * stands on its own rather than handed over as a bare fragment.
   */
  const askAboutContext = useCallback(
    (text: string) => onAskChat(`Tell me more about this from the meeting:\n\n"${text}"`),
    [onAskChat],
  );

  if (cards.length === 0) {
    return <EmptySuggestState />;
  }

  return (
    <div className="flex flex-col gap-3">
      <ContextSection items={primaryCard?.contextItems ?? []} onAsk={askAboutContext} />

      <div className="flex items-center justify-between">
        <SectionLabel>Suggest Answers</SectionLabel>
        <SuggestFilterToggle scope={scope} onChange={setScope} />
      </div>

      {visibleCards.length > 0 ? (
        <div className="flex flex-col gap-3">
          {visibleCards.map((card) => (
            <SuggestCard
              key={card.id}
              card={card}
              onAskChat={onAskChat}
              onRefine={(instruction, label) => refineCard(card.id, instruction, label)}
              onUndoRefine={() => undoRefine(card.id)}
              pendingLabel={refining?.cardId === card.id ? refining.label : null}
              busy={refining !== null}
              errorMessage={refineError?.cardId === card.id ? refineError.message : null}
            />
          ))}
        </div>
      ) : (
        <p className="text-[13px]" style={{ color: tokens.mute }}>
          No suggestions to show yet.
        </p>
      )}
    </div>
  );
};
