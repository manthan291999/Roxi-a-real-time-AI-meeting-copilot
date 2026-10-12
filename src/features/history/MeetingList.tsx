import React, { useMemo, useState } from 'react';
import { Meeting } from '../../shared/types';
import { tokens, radius, SearchIcon, SparkleIcon, CloseIcon } from '../../design-system';
import { LiveBadge } from '../../design-system/components/LiveBadge';
import { groupMeetingsByDay, formatRowDate } from './groupMeetings';

/** What the content pane is showing: the Ask Roxi thread, or one meeting. */
export type HistorySelection = { kind: 'ask' } | { kind: 'meeting'; id: string };

interface MeetingListProps {
  meetings: Meeting[];
  selection: HistorySelection;
  /** The row currently being recorded, if any — it jumps to the live session instead of opening. */
  liveMeetingId: string | null;
  onSelectAsk: () => void;
  onSelectMeeting: (meeting: Meeting) => void;
  onGoLive?: () => void;
}

const ROW_CLASS =
  'w-full flex items-center gap-2.5 px-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]';

/**
 * The list column: search, a pinned Ask Roxi row, then meetings grouped by
 * day. Presentational apart from the search text, which only this column reads.
 */
export const MeetingList: React.FC<MeetingListProps> = ({
  meetings,
  selection,
  liveMeetingId,
  onSelectAsk,
  onSelectMeeting,
  onGoLive,
}) => {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const visible = needle
      ? meetings.filter((m) => (m.title || 'Untitled meeting').toLowerCase().includes(needle))
      : meetings;
    return groupMeetingsByDay(visible);
  }, [meetings, needle]);

  const askSelected = selection.kind === 'ask';

  return (
    <nav aria-label="Meetings" className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 flex flex-col gap-3 px-3 pt-3 pb-2">
        <div className="flex items-baseline gap-2 px-1">
          <h2 className="flex-1 text-[17px] font-bold tracking-[-0.01em]" style={{ color: tokens.paper }}>
            Past Meetings
          </h2>
          <span className="text-[12px] tabular-nums" style={{ color: tokens.mute }}>
            {meetings.length} {meetings.length === 1 ? 'meeting' : 'meetings'}
          </span>
        </div>

        <label
          className="h-7 flex items-center gap-1.5 px-2 transition-shadow focus-within:shadow-[0_0_0_3px_var(--t-signal-focus)]"
          style={{ borderRadius: 7, background: tokens.panelRaised, color: tokens.mute }}
        >
          <SearchIcon className="w-3.5 h-3.5 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && query && (e.stopPropagation(), setQuery(''))}
            placeholder="Search meetings"
            aria-label="Search meetings"
            className="flex-1 min-w-0 bg-transparent text-[13px] outline-none placeholder:text-[var(--t-mute)] [&::-webkit-search-cancel-button]:hidden"
            style={{ color: tokens.paper }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="w-4 h-4 rounded-full flex items-center justify-center"
              style={{ background: tokens.muteDim, color: tokens.ink }}
            >
              <CloseIcon className="w-2.5 h-2.5" />
            </button>
          )}
        </label>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-2 pb-3 flex flex-col gap-0.5">
        <button
          type="button"
          onClick={onSelectAsk}
          aria-current={askSelected ? 'page' : undefined}
          className={`${ROW_CLASS} h-12 ${askSelected ? '' : 'hover:bg-[var(--t-overlay-hover)]'}`}
          style={{ borderRadius: radius.chip, background: askSelected ? tokens.signalDim : 'transparent' }}
        >
          <span
            aria-hidden="true"
            className="w-7 h-7 shrink-0 rounded-[7px] flex items-center justify-center border"
            style={{ background: tokens.card, borderColor: tokens.hairlineSoft }}
          >
            <SparkleIcon className="w-4 h-4" />
          </span>
          <span className="flex-1 min-w-0 flex flex-col">
            <span className="text-[13px] font-semibold" style={{ color: askSelected ? tokens.signal : tokens.paper }}>
              Ask Roxi
            </span>
            <span className="text-[12px] truncate" style={{ color: tokens.mute }}>
              Search across every meeting
            </span>
          </span>
        </button>

        {groups.length === 0 && (
          <p className="px-3 py-6 text-center text-[12px]" style={{ color: tokens.mute }}>
            No meetings match “{query.trim()}”.
          </p>
        )}

        {groups.map((group) => (
          <section key={group.label} aria-label={group.label} className="flex flex-col gap-0.5">
            <h3 className="px-2.5 pt-3 pb-1 text-[11px] font-semibold" style={{ color: tokens.mute }}>
              {group.label}
            </h3>
            {group.meetings.map((meeting) => {
              const isLive = meeting.id === liveMeetingId;
              const selected = selection.kind === 'meeting' && selection.id === meeting.id;
              return (
                <button
                  key={meeting.id}
                  type="button"
                  onClick={() => (isLive ? onGoLive?.() : onSelectMeeting(meeting))}
                  aria-current={selected ? 'page' : undefined}
                  className={`${ROW_CLASS} h-11 ${selected ? '' : 'hover:bg-[var(--t-overlay-hover)]'}`}
                  style={{ borderRadius: radius.chip, background: selected ? tokens.signal : 'transparent' }}
                >
                  <span
                    className="flex-1 min-w-0 truncate text-[13px] font-medium"
                    style={{ color: selected ? tokens.onSignal : tokens.paper }}
                  >
                    {meeting.title || 'Untitled meeting'}
                  </span>
                  {isLive ? (
                    <LiveBadge />
                  ) : (
                    <span
                      className="shrink-0 text-[12px] tabular-nums"
                      style={{ color: selected ? tokens.onSignal : tokens.mute, opacity: selected ? 0.85 : 1 }}
                    >
                      {formatRowDate(meeting.date)}
                    </span>
                  )}
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </nav>
  );
};
