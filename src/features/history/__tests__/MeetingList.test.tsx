// Brings jest-dom's matcher types into tsc; vitest.setup.ts registers them at runtime but sits outside tsconfig's src include.
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MeetingList } from '../MeetingList';
import { groupMeetingsByDay } from '../groupMeetings';

const NOW = new Date(2026, 8, 26, 17, 0);
const at = (days: number, hour = 10) => new Date(2026, 8, 26 - days, hour).toISOString();

const MEETINGS = [
  { id: '5', title: 'Din', date: at(0, 15) },
  { id: '4', title: 'Mdd', date: at(0, 10) },
  { id: '3', title: 'Design review', date: at(1) },
  { id: '2', title: 'Test1234567890', date: at(2) },
  { id: '1', title: '', date: at(40) },
];

describe('groupMeetingsByDay', () => {
  it('buckets by recency and keeps newest-first order', () => {
    const groups = groupMeetingsByDay(MEETINGS, NOW);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Previous 7 Days', 'August 2026']);
    expect(groups[0].meetings.map((m) => m.id)).toEqual(['5', '4']);
  });

  it('puts unparseable dates in their own group instead of throwing', () => {
    expect(groupMeetingsByDay([{ id: 'x', title: 'Broken', date: 'nope' }], NOW)[0].label).toBe('Undated');
  });
});

function renderList(props: Partial<React.ComponentProps<typeof MeetingList>> = {}) {
  const handlers = { onSelectAsk: vi.fn(), onSelectMeeting: vi.fn(), onGoLive: vi.fn() };
  render(
    <MeetingList meetings={MEETINGS} selection={{ kind: 'ask' }} liveMeetingId={null} {...handlers} {...props} />,
  );
  return handlers;
}

describe('MeetingList', () => {
  it('opens the meeting clicked and labels untitled ones', () => {
    const { onSelectMeeting } = renderList();
    expect(screen.getByText('5 meetings')).toBeInTheDocument();
    expect(screen.getByText('Untitled meeting')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Design review/ }));
    expect(onSelectMeeting).toHaveBeenCalledWith(MEETINGS[2]);
  });

  it('filters by title and says when nothing matches', () => {
    renderList();
    const search = screen.getByRole('searchbox', { name: 'Search meetings' });
    fireEvent.change(search, { target: { value: 'design' } });
    const nav = screen.getByRole('navigation', { name: 'Meetings' });
    expect(within(nav).getByText('Design review')).toBeInTheDocument();
    expect(within(nav).queryByText('Din')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText(/No meetings match/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(within(nav).getByText('Din')).toBeInTheDocument();
  });

  it('sends the live row back to the session instead of opening it', () => {
    const { onGoLive, onSelectMeeting } = renderList({ liveMeetingId: '5' });
    fireEvent.click(screen.getByRole('button', { name: /Din/ }));
    expect(onGoLive).toHaveBeenCalledTimes(1);
    expect(onSelectMeeting).not.toHaveBeenCalled();
  });

  it('marks Ask Roxi as the current view and returns to it', () => {
    const { onSelectAsk } = renderList({ selection: { kind: 'meeting', id: '4' } });
    expect(screen.getByRole('button', { name: /Mdd/ })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: /Ask Roxi/ }));
    expect(onSelectAsk).toHaveBeenCalledTimes(1);
  });
});
