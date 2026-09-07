import { ChatMessage } from '../types';

export interface IChatService {
  ask(question: string, threadId?: string, history?: ChatMessage[]): Promise<void>;
  close(): Promise<void>;
}
