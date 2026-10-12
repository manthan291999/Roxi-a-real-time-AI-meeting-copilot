import React, { useEffect, useState } from 'react';
import { MeetingDetail } from '../../shared/types';
import { tokens, radius, ChevronLeftIcon, CopyIcon, CheckIcon, useCopyToClipboard } from '../../design-system';
import { Spinner } from '../../shared/ui/Spinner';
import { formatLongDate } from './groupMeetings';

type DetailTab = 'summary' | 'transcript';

interface MeetingDetailViewProps {
  meeting: MeetingDetail;
  isLoading: boolean;
  /** Back to the list — only visible when the pane is too narrow for both columns. */
  onBack: () => void;
}

/** Plain-text export of whatever tab is showing, for the Copy button. */
function copyText(meeting: MeetingDetail, tab: DetailTab): string {
  if (tab === 'transcript') return meeting.transcript ?? '';
  const lines = [meeting.title || 'Untitled meeting', formatLongDate(meeting.date)];
  if (meeting.decisions.length) lines.push('', 'Decisions', ...meeting.decisions.map((d) => `• ${d}`));
  if (meeting.actionItems.length) lines.push('', 'Action items', ...meeting.actionItems.map((a) => `• ${a}`));
  return lines.join('\n');
}

const SegmentedControl: React.FC<{ value: DetailTab; onChange: (tab: DetailTab) => void }> = ({ value, onChange }) => (
  <div role="tablist" aria-label="View" className="flex h-[26px] p-0.5 rounded-[7px]" style={{ background: tokens.panelRaised }}>
    {(['summary', 'transcript'] as const).map((tab) => {
      const selected = tab === value;
      return (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={selected}
          onClick={() => onChange(tab)}
          className="px-3 rounded-[5px] text-[12px] capitalize transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--t-focus-ring)]"
          style={{
            background: selected ? tokens.ink : 'transparent',
            boxShadow: selected ? '0 1px 2px var(--t-hairline)' : 'none',
            color: tokens.paper,
            fontWeight: selected ? 600 : 400,
          }}
        >
          {tab}
        </button>
      );
    })}
  </div>
);

/** A titled System Settings-style group: one card, rows split by inset hairlines. */
const DetailGroup: React.FC<{ title: string; items: string[]; marker: React.ReactNode; empty: string }> = ({
  title,
  items,
  marker,
  empty,
}) => (
  <section className="flex flex-col gap-2" aria-label={title}>
    <h2 className="px-1 text-[13px] font-semibold" style={{ color: tokens.mute }}>
      {title}
      {items.length > 0 && <span className="ml-1.5 font-normal tabular-nums">{items.length}</span>}
    </h2>
    {items.length === 0 ? (
      <p className="px-1 text-[13px]" style={{ color: tokens.mute }}>{empty}</p>
    ) : (
      <ul
        className="border overflow-hidden divide-y divide-[var(--t-hairline-soft)]"
        style={{ borderRadius: radius.control, background: tokens.card, borderColor: tokens.hairline, boxShadow: tokens.cardInset }}
      >
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5 px-3.5 py-2.5 text-[13px] leading-[18px]" style={{ color: tokens.paper }}>
            {marker}
            <span className="flex-1 min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    )}
  </section>
);

/** One meeting, inline in the content pane: Summary (decisions, action items) or Transcript. */
export const MeetingDetailView: React.FC<MeetingDetailViewProps> = ({ meeting, isLoading, onBack }) => {
  const [tab, setTab] = useState<DetailTab>('summary');
  const { copied, copy } = useCopyToClipboard();

  // A different meeting starts on its summary, not on whatever tab the last one was left on.
  useEffect(() => setTab('summary'), [meeting.id]);

  const transcriptFailed = meeting.transcript === null;
  const hasTranscript = typeof meeting.transcript === 'string' && meeting.transcript.trim().length > 0;
  const text = copyText(meeting, tab);

  return (
    <article className="flex h-full min-h-0 flex-col" aria-label={meeting.title || 'Untitled meeting'}>
      <header className="h-[52px] shrink-0 flex items-center gap-2 px-4 border-b" style={{ borderColor: tokens.hairlineSoft }}>
        <button
          type="button"
          onClick={onBack}
          className="roxi-split-back h-7 items-center gap-0.5 pl-1 pr-2 rounded-[7px] text-[13px] hover:bg-[var(--t-overlay-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--t-focus-ring)]"
          style={{ color: tokens.signal }}
        >
          <ChevronLeftIcon className="w-4 h-4" />
          Meetings
        </button>
        <SegmentedControl value={tab} onChange={setTab} />
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => copy(text)}
          disabled={isLoading || !text}
          title={tab === 'summary' ? 'Copy the summary as plain text' : 'Copy the full transcript'}
          className="h-7 flex items-center gap-1.5 px-3 rounded-[7px] border text-[12px] font-medium transition-colors hover:enabled:bg-[var(--t-overlay-hover)] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--t-focus-ring)]"
          style={{ background: tokens.card, borderColor: tokens.hairline, color: tokens.paper }}
        >
          {copied ? <CheckIcon className="w-3.5 h-3.5" style={{ color: tokens.decision }} /> : <CopyIcon className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : tab === 'summary' ? 'Copy Summary' : 'Copy Transcript'}
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-7 py-6">
        <div className="max-w-[680px] flex flex-col gap-5">
          <div>
            <h1 className="text-[22px] leading-7 font-bold tracking-[-0.02em]" style={{ color: tokens.paper }}>
              {meeting.title || 'Untitled meeting'}
            </h1>
            <p className="mt-1 text-[13px]" style={{ color: tokens.mute }}>{formatLongDate(meeting.date)}</p>
          </div>

          {isLoading ? (
            <div className="py-16 flex justify-center"><Spinner size={22} /></div>
          ) : tab === 'summary' ? (
            <>
              <DetailGroup
                title="Decisions"
                items={meeting.decisions}
                empty="Roxi didn't record any decisions in this meeting."
                marker={<span aria-hidden="true" className="mt-[6px] w-[7px] h-[7px] shrink-0 rounded-full" style={{ background: tokens.decision }} />}
              />
              <DetailGroup
                title="Action items"
                items={meeting.actionItems}
                empty="No action items were flagged."
                marker={<span aria-hidden="true" className="mt-[3px] w-3 h-3 shrink-0 rounded-[3px] border" style={{ borderColor: tokens.signalLine }} />}
              />
              {hasTranscript && (
                <button
                  type="button"
                  onClick={() => setTab('transcript')}
                  className="self-start text-[13px] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--t-focus-ring)] rounded"
                  style={{ color: tokens.signal }}
                >
                  Read the Full Transcript
                </button>
              )}
            </>
          ) : transcriptFailed ? (
            <p className="text-[13px]" style={{ color: tokens.risk }}>
              Couldn't load this transcript. Open the meeting again to retry.
            </p>
          ) : hasTranscript ? (
            <div className="text-[13px] leading-[1.7] whitespace-pre-wrap select-text" style={{ color: tokens.paper }}>
              {meeting.transcript}
            </div>
          ) : (
            <p className="text-[13px]" style={{ color: tokens.mute }}>
              This meeting has no transcript. It may have ended before anyone spoke.
            </p>
          )}
        </div>
      </div>
    </article>
  );
};
