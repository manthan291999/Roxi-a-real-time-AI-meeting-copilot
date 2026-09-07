import React from 'react';
import { SectionLabel, tokens } from '../../design-system';
import { useSuggestAnswers } from './useSuggestAnswers';
import { useSuggestFilters } from './useSuggestFilters';
import { SuggestCard } from './SuggestCard';
import { SuggestFilterToggle } from './SuggestFilterToggle';
import { ContextSection } from './ContextSection';
import { TagFilterRow } from './TagFilterRow';
import { FollowUpRow } from './FollowUpRow';
import { EmptySuggestState } from './EmptySuggestState';

interface SuggestAnswersPaneProps {
  onAskChat: (question: string) => void;
}

/** Composition only: the visibility rules live in useSuggestFilters. */
export const SuggestAnswersPane: React.FC<SuggestAnswersPaneProps> = ({ onAskChat }) => {
  const { cards } = useSuggestAnswers();
  const { scope, setScope, selectedTags, toggleTag, visibleCards, primaryCard, hasTagFilter } =
    useSuggestFilters(cards);

  if (cards.length === 0) {
    return <EmptySuggestState />;
  }

  return (
    <div className="flex flex-col gap-3">
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
          No suggestions match the selected tags yet.
        </p>
      )}

      <ContextSection items={primaryCard?.contextItems ?? []} />

      <div className="flex flex-col gap-3">
        <TagFilterRow selectedTags={selectedTags} onToggle={toggleTag} />
        <FollowUpRow onSelect={onAskChat} />
      </div>

      {hasTagFilter && (
        <span className="text-[11px]" style={{ color: tokens.muteDim }}>
          Filtering by {selectedTags.size} tag{selectedTags.size > 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
};
