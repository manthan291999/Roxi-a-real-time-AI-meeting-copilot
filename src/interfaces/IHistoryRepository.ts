import { DbMeeting, DbMeetingDetails } from '../types';

export interface IHistoryRepository {
  getMeetings(): Promise<DbMeeting[]>;
  getMeetingDetails(id: number): Promise<DbMeetingDetails>;
}
