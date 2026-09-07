import React from 'react';
import { ChatSource } from '../../../shared/types';
import { tokens, radius } from '../../../design-system';

/**
 * One evidence card behind an answer.
 *
 * Reads `snippet`, which is what the sidecar actually sends. The previous
 * inline version read `meeting_title` and `text` — fields that have never been
 * on the wire — so every card rendered with a blank title and a blank body.
 *
 * Handles both corpora. A meeting hit has no `sourceType`, so its absence is
 * treated as 'meeting' and document support stays purely additive.
 */
export const SourceChip: React.FC<{ source: ChatSource }> = ({ source }) => {
  const isDocument = source.sourceType === 'document';

  const title = isDocument
    ? source.fileName || 'Document'
    : source.meetingId != null
      ? `Meeting #${source.meetingId}`
      : 'Meeting';

  const detail = isDocument
    ? source.pageNumber != null
      ? `p${source.pageNumber}`
      : ''
    : source.date
      ? new Date(source.date).toLocaleDateString()
      : '';

  return (
    <div
      className="text-[11px] p-2 flex flex-col gap-1 max-w-[280px]"
      style={{
        background: tokens.panelRaised,
        border: `1px solid ${tokens.hairline}`,
        borderRadius: radius.card,
      }}
    >
      <div
        className="flex items-center justify-between gap-2 font-medium"
        style={{ color: tokens.mute }}
      >
        <span className="truncate">
          <span aria-hidden="true" className="mr-1">
            {isDocument ? '\u{1F4C4}' : '\u{1F399}\u{FE0F}'}
          </span>
          {title}
        </span>
        {detail && <span className="shrink-0">{detail}</span>}
      </div>

      <div className="line-clamp-3" style={{ color: tokens.paper }}>
        {!isDocument && source.speaker && (
          <span className="font-medium mr-1" style={{ color: tokens.signal }}>
            {source.speaker}:
          </span>
        )}
        {source.snippet}
      </div>
    </div>
  );
};
