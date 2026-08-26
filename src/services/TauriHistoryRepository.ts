import { invoke } from '@tauri-apps/api/core';
import { IHistoryRepository } from '../interfaces/IHistoryRepository';
import { DbMeeting, DbMeetingDetails } from '../types';

export class TauriHistoryRepository implements IHistoryRepository {
  async getMeetings(): Promise<DbMeeting[]> {
    return invoke<DbMeeting[]>('get_meetings');
  }

  async getMeetingDetails(id: number): Promise<DbMeetingDetails> {
    return invoke<DbMeetingDetails>('get_meeting_details', { id });
  }
}
