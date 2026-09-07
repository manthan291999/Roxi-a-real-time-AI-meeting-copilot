export type ChatRole = 'user' | 'assistant';

/** The threads the widget keeps. See ChatThreadProvider. */
export const CHAT_THREAD_IDS = ['ask', 'history'] as const;
export type ChatThreadId = (typeof CHAT_THREAD_IDS)[number];

/**
 * One piece of evidence behind an answer, exactly as the sidecar emits it
 * (chatbot/src/application/graph/evidence.js `toSources`).
 *
 * Named to match the wire: the previous shape declared `meeting_title` and
 * `text`, neither of which the sidecar has ever sent, so every source card
 * rendered blank.
 *
 * `ref` is the citation token used inline in the answer ('M3', 'D2'), stable
 * only within the answer it came with. The document fields are absent on
 * meeting hits and the meeting fields are absent on document hits.
 */
export interface ChatSource {
  ref?: string;
  sourceType?: 'meeting' | 'document';
  meetingId?: number;
  date?: string;
  speaker?: string;
  snippet?: string;
  sourceTable?: string;
  docId?: string;
  fileName?: string;
  pageNumber?: number | null;
}

/**
 * Payload of the `chat_reply` Tauri event — the sidecar's ChatReply payload
 * (chatbot AnswerQuestionUseCase.run). `threadId` identifies which thread the
 * answer belongs to; it is optional because the sidecar has not always stamped
 * it, and a response without one is routed to whichever thread is awaiting.
 */
export interface ChatReplyEvent {
  threadId?: string;
  answer?: string;
  clarifyingQuestion?: string;
  sources?: ChatSource[];
  followUps?: string[];
  route?: string;
  attempts?: number;
  degradedNote?: string;
}

/**
 * Payload of `chat_thinking`. Accepts a bare string as well as the object
 * form, because the host has emitted the node name unwrapped.
 */
export interface ChatThinkingEvent {
  threadId?: string;
  node?: string;
}

/** Payload of `chat_error`. */
export interface ChatErrorEvent {
  threadId?: string;
  message?: string;
  code?: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  sources?: ChatSource[];
  followUps?: string[];
  clarifyingQuestion?: string;
}
