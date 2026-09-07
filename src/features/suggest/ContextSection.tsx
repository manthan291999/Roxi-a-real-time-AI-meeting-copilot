import React from 'react';
import { ContextItem } from '../../shared/types';
import { ContextLegend, ContextRow, SectionLabel, tokens } from '../../design-system';
import { InfoIcon } from '../../design-system/icons';

interface ContextSectionProps {
  items: ContextItem[];
}

/** The retrieval trail behind a suggestion: what Roxi matched, and how strongly. */
export const ContextSection: React.FC<ContextSectionProps> = ({ items }) => {
  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-2.5">
      <SectionLabel
        trailing={
          <span title="Where this suggestion came from" style={{ color: tokens.muteDim }}>
            <InfoIcon className="w-3.5 h-3.5" />
          </span>
        }
      >
        Context
      </SectionLabel>

      <div className="flex flex-col gap-1.5">
        {items.map((item, index) => (
          <ContextRow key={`${index}-${item.text}`} item={item} />
        ))}
      </div>

      <ContextLegend />
    </section>
  );
};
