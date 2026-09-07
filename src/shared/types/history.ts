export interface Meeting {
  id: string;
  title: string;
  date: string;
}

export interface MeetingDetail extends Meeting {
  transcript: string;
  decisions: string[];
  actionItems: string[];
}
