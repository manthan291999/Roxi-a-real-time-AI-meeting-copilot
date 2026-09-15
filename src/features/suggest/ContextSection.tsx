import React from 'react';
import { ContextItem } from '../../shared/types';
import { ContextLegend, ContextRow, CopyButton, SectionLabel, tokens } from '../../design-system';
import { InfoIcon } from '../../design-system/icons';

interface ContextSectionProps {
  items: ContextItem[];
  /** Forwarded to each row's Ask action; omit to hide it. */
  onAsk?: (text: string) => void;
}

/** The retrieval trail behind a suggestion: what Roxi matched, and how strongly. */
export const ContextSection: React.FC<ContextSectionProps> = ({ items, onAsk }) => {
  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-2.5">
      <SectionLabel
        trailing={
          <span className="flex items-center gap-1">
            <span title="Where this suggestion came from" style={{ color: tokens.muteDim }}>
              <InfoIcon className="w-3.5 h-3.5" />
            </span>
            {/* Copies every line at once. Several snippets together are what a
                person actually pastes somewhere; one at a time is the slow
                version of the same job. */}
            <CopyButton
              text={() => items.map((item) => item.text).join('\n')}
              subject="all context lines"
            />
          </span>
        }
      >
        Context
      </SectionLabel>

      <div className="flex flex-col gap-1.5">
        {items.map((item, index) => (
          <ContextRow key={`${index}-${item.text}`} item={item} onAsk={onAsk} />
        ))}
      </div>

      <ContextLegend />
    </section>
  );
};
