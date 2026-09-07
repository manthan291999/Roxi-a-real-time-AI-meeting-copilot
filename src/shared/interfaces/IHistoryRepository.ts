import { Meeting, MeetingDetail } from '../types';

export interface IHistoryRepository {
  getMeetings(): Promise<Meeting[]>;
  getMeetingDetails(id: string): Promise<MeetingDetail>;
}
