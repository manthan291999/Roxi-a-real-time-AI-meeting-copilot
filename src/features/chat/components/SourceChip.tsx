import React from 'react';
import { openExternalUrl } from '../../../services/externalLinks';
import { ChatSource } from '../../../shared/types';
import { tokens, radius } from '../../../design-system';

/**
 * One evidence card behind an answer.
 *
 * Reads `snippet`, which is what the sidecar actually sends. The previous
 * inline version read `meeting_title` and `text` — fields that have never been
 * on the wire — so every card rendered with a blank title and a blank body.
 *
 * Handles all five corpora. A meeting hit has no `sourceType`, so its
 * absence is treated as 'meeting' and document/live/semantic/web support stays
 * additive.
 *
 * A web card is the only interactive one: it has somewhere to go. It renders
 * as a real button rather than an anchor because a Tauri webview will not open
 * `target="_blank"` in the user's browser — the opener plugin does that, and
 * the app already depends on it.
 */
export const SourceChip: React.FC<{ source: ChatSource }> = ({ source }) => {
  const kind =
    source.sourceType === 'document'
    || source.sourceType === 'live'
    || source.sourceType === 'semantic'
    || source.sourceType === 'web'
      ? source.sourceType
      : 'meeting';

  const isWeb = kind === 'web' && Boolean(source.url);

  const icon =
    kind === 'document'
      ? '\u{1F4C4}'
      : kind === 'live'
        ? '\u{1F534}'
        : kind === 'semantic'
          ? '\u{1F4D6}'
          : kind === 'web'
            ? '\u{1F310}'
            : '\u{1F399}\u{FE0F}';

  const title =
    kind === 'document'
      ? source.fileName || 'Document'
      : kind === 'live'
        ? 'Live'
        : kind === 'semantic'
          ? 'Glossary'
          : kind === 'web'
            ? source.title || hostOf(source.url) || 'Web page'
            : source.meetingName || (source.meetingId != null ? `Meeting #${source.meetingId}` : 'Meeting');

  const detail =
    kind === 'document'
      ? source.pageNumber != null
        ? `p${source.pageNumber}`
        : ''
      : kind === 'live'
        ? 'now'
        : kind === 'semantic'
          ? ''
          : kind === 'web'
            ? hostOf(source.url)
            : source.date
              ? new Date(source.date).toLocaleDateString()
              : '';

  const openSource = () => {
    // Best effort: a card that cannot open must not take the pane down with it.
    openExternalUrl(source.url);
  };

  const body = (
    <>
      <div
        className="flex items-center justify-between gap-2 font-medium w-full"
        style={{ color: tokens.mute }}
      >
        <span className="truncate">
          <span aria-hidden="true" className="mr-1">
            {icon}
          </span>
          {title}
        </span>
        {detail && <span className="shrink-0">{detail}</span>}
      </div>

      <div className="line-clamp-3 w-full" style={{ color: tokens.paper }}>
        {kind !== 'document' && kind !== 'web' && source.speaker && (
          <span className="font-medium mr-1" style={{ color: tokens.signal }}>
            {source.speaker}:
          </span>
        )}
        {source.snippet}
      </div>
    </>
  );

  const style = {
    background: tokens.panelRaised,
    border: `1px solid ${tokens.hairline}`,
    borderRadius: radius.card,
  } as const;

  if (isWeb) {
    return (
      <button
        type="button"
        onClick={openSource}
        title={source.url}
        className="text-[11px] p-2 flex flex-col gap-1 max-w-[280px] text-left transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ ...style, outlineColor: tokens.focusRing }}
      >
        {body}
      </button>
    );
  }

  return (
    <div className="text-[11px] p-2 flex flex-col gap-1 max-w-[280px]" style={style}>
      {body}
    </div>
  );
};

/** Bare hostname, for the card's detail slot. '' when the url is unusable. */
function hostOf(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
