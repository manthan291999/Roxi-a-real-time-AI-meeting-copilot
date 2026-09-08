import { ChatMessage } from '../types';

export interface IChatService {
  /**
   * @param liveContext recent lines from the meeting currently being recorded,
   *   if any — bridges the gap before those lines are indexed for search.
   */
  ask(
    question: string,
    threadId?: string,
    history?: ChatMessage[],
    liveContext?: string,
  ): Promise<void>;
  close(): Promise<void>;
}
