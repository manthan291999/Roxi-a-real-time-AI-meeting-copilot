export type ChatRole = 'user' | 'assistant';

export interface ChatSource {
  meeting_id?: string;
  meeting_title?: string;
  speaker?: string;
  text?: string;
  date?: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  sources?: ChatSource[];
  followUps?: string[];
  clarifyingQuestion?: string;
}
