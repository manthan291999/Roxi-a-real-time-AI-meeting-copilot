import React from 'react';
import { SectionLabel, tokens } from '../../design-system';
import { useSuggestAnswers } from './useSuggestAnswers';
import { useSuggestFilters } from './useSuggestFilters';
import { SuggestCard } from './SuggestCard';
import { SuggestFilterToggle } from './SuggestFilterToggle';
import { ContextSection } from './ContextSection';
import { FollowUpRow } from './FollowUpRow';
import { EmptySuggestState } from './EmptySuggestState';

interface SuggestAnswersPaneProps {
  onAskChat: (question: string) => void;
}

/**
 * Composition only: the visibility rules live in useSuggestFilters.
 *
 * Context is read BEFORE the suggestions — what Roxi matched in the meeting
 * comes first, what it suggests you say comes second. The tag filter row is
 * deliberately not rendered (see TagFilterRow.tsx); useSuggestFilters still
 * owns the tag rules, so re-adding the row is one line here.
 */
export const SuggestAnswersPane: React.FC<SuggestAnswersPaneProps> = ({ onAskChat }) => {
  const { cards } = useSuggestAnswers();
  const { scope, setScope, visibleCards, primaryCard } = useSuggestFilters(cards);

  if (cards.length === 0) {
    return <EmptySuggestState />;
  }

  return (
    <div className="flex flex-col gap-3">
      <ContextSection items={primaryCard?.contextItems ?? []} />

      <div className="flex items-center justify-between">
        <SectionLabel>Suggest Answers</SectionLabel>
        <SuggestFilterToggle scope={scope} onChange={setScope} />
      </div>

      {visibleCards.length > 0 ? (
        <div className="flex flex-col gap-3">
          {visibleCards.map((card) => (
            <SuggestCard key={card.id} card={card} />
          ))}
        </div>
      ) : (
        <p className="text-[13px]" style={{ color: tokens.mute }}>
          No suggestions to show yet.
        </p>
      )}

      <FollowUpRow onSelect={onAskChat} />
    </div>
  );
};
