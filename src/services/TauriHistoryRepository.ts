import { invoke } from '@tauri-apps/api/core';
import { IHistoryRepository } from '../shared/interfaces';
import { Meeting, MeetingDetail } from '../shared/types';

export class TauriHistoryRepository implements IHistoryRepository {
  async getMeetings(): Promise<Meeting[]> {
    return await invoke<Meeting[]>('get_meetings');
  }

  async getMeetingDetails(id: string): Promise<MeetingDetail> {
    return await invoke<MeetingDetail>('get_meeting_details', { id });
  }
}
