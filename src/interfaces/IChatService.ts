import { IEventHandler, UnsubscribeFn } from './IEventBus';

/** One cited meeting excerpt under an answer. */
export interface ChatSource {
  meetingId: number;
  date: string;
  speaker: string;
  snippet: string;
  sourceTable: string;
}

/** Final answer payload from the chatbot graph. */
export interface ChatReplyPayload {
  answer: string;
  sources: ChatSource[];
  clarifyingQuestion: string;
  followUps: string[];
  route: 'generate' | 'clarify' | 'no_data' | string;
  attempts: number;
  degradedNote: string;
}

export interface ChatErrorPayload {
  message: string;
  code: string;
}

/** One prior chat turn (for thread rehydration after sidecar restarts). */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Chat service contract — transport-agnostic from the UI's perspective.
 * ask() fires the request; results arrive via the event subscriptions
 * (mirrors how capture events flow through IEventBus).
 */
export interface IChatService {
  ask(question: string, threadId: string, history: ChatTurn[]): Promise<void>;
  close(): Promise<void>;
  onThinking(handler: IEventHandler<string>): Promise<UnsubscribeFn>;
  onReply(handler: IEventHandler<ChatReplyPayload>): Promise<UnsubscribeFn>;
  onError(handler: IEventHandler<ChatErrorPayload>): Promise<UnsubscribeFn>;
}
