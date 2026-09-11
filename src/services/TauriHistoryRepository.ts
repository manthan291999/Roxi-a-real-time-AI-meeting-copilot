import { invoke } from '@tauri-apps/api/core';
import { IHistoryRepository } from '../shared/interfaces';
import { Meeting, MeetingDetail } from '../shared/types';

interface RawMeeting {
  id: number;
  start_time: string;
  end_time: string | null;
  context: string | null;
  summary: string | null;
  name: string | null;
}

interface RawMeetingDetails {
  meeting: RawMeeting;
  decisions: { description: string }[];
  action_items: { description: string; assignee: string | null }[];
  transcripts: { speaker: string; text: string }[];
}

function toMeeting(raw: RawMeeting): Meeting {
  const title = raw.name?.trim()
    || raw.context?.trim()
    || (raw.summary ? raw.summary.slice(0, 80).trimEnd() + '…' : null)
    || `Meeting on ${new Date(raw.start_time + 'Z').toLocaleDateString()}`;

  const date = raw.start_time
    ? new Date(raw.start_time + 'Z').toISOString()
    : new Date().toISOString();

  return { id: String(raw.id), title, date };
}

export class TauriHistoryRepository implements IHistoryRepository {
  async getMeetings(): Promise<Meeting[]> {
    const raw = await invoke<RawMeeting[]>('get_meetings');
    return raw.map(toMeeting);
  }

  async getMeetingDetails(id: string): Promise<MeetingDetail> {
    const raw = await invoke<RawMeetingDetails>('get_meeting_details', { id: parseInt(id, 10) });
    const meeting = toMeeting(raw.meeting);
    
    return {
      ...meeting,
      transcript: raw.transcripts.map(t => `[${t.speaker}] ${t.text}`).join('\n'),
      decisions: raw.decisions.map(d => d.description),
      actionItems: raw.action_items.map(a => a.description),
    };
  }
}
