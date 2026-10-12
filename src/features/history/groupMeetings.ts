import { Meeting } from '../../shared/types';

export interface MeetingGroup {
  label: string;
  meetings: Meeting[];
}

const DAY_MS = 86_400_000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Whole calendar days between `date` and `now` (0 = today). NaN for an unparseable date. */
function daysAgo(date: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
}

/** Mail/Notes-style bucket for one date: Today, Yesterday, Previous 7 Days, Previous 30 Days, then "September 2026". */
function bucketFor(date: Date, now: Date): string {
  const days = daysAgo(date, now);
  if (Number.isNaN(days)) return 'Undated';
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 Days';
  if (days < 30) return 'Previous 30 Days';
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/**
 * Buckets meetings by recency, keeping the incoming order (newest first, as
 * get_meetings returns them) both across and within groups.
 */
export function groupMeetingsByDay(meetings: Meeting[], now = new Date()): MeetingGroup[] {
  const groups: MeetingGroup[] = [];
  for (const meeting of meetings) {
    const label = bucketFor(new Date(meeting.date), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.meetings.push(meeting);
    else groups.push({ label, meetings: [meeting] });
  }
  return groups;
}

/** The trailing value on a list row: a time today/yesterday, a weekday this week, else a short date. */
export function formatRowDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const days = daysAgo(date, now);
  if (Number.isNaN(days)) return '';
  if (days <= 1) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The full line under a meeting's title in the detail view: "Friday 26 September 2026, 3:46 PM". */
export function formatLongDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
