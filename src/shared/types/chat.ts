export type ChatRole = 'user' | 'assistant';

/**
 * Which corpus an Ask consults — the wire value of the "Knowledge" switch,
 * spelled exactly as the sidecar's `mode` field so no mapper is needed.
 *
 * 'rag'    — search meetings, documents, vector memory and the live transcript.
 * 'direct' — answer from the model alone: no retrieval, and no sources.
 *
 * The user-facing wording lives in the component; this is the protocol.
 */
export const CHAT_MODES = ['rag', 'direct'] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

/** The default for every thread: a question searches the meetings. */
export const DEFAULT_CHAT_MODE: ChatMode = 'rag';

/**
 * Whether an Ask may reach the web — the wire value of the "Web" switch,
 * spelled exactly as the sidecar's `webMode` field.
 *
 * A SECOND, INDEPENDENT axis from ChatMode above. Knowledge says which of the
 * user's own corpora a turn may read; this says whether it may look outside.
 *
 * Unlike ChatMode there is NO UI control for it and the app never sends it:
 * the model is offered the tool on every turn and decides for itself. The type
 * exists because the protocol, the CLI and the sidecar's own config still
 * speak it, and because a caller that wants to pin a mode can.
 *
 * 'auto'   — the model is offered a web-search tool and decides for itself
 *            whether the question needs one. No extra round-trip: a question
 *            it can answer directly costs exactly what it cost before.
 * 'always' — search is forced. Research / fact-check mode. Reachable over the
 *            protocol and from the CLI, never from the UI.
 * 'never'  — no tool is sent at all, so there is nothing for the model to use.
 */
export const WEB_MODES = ['auto', 'always', 'never'] as const;
export type WebMode = (typeof WEB_MODES)[number];

/**
 * There is no UI switch and no per-thread default: the model is offered the
 * tool on every turn and decides for itself. The one place the mode is set is
 * the sidecar's CHATBOT_WEB_SEARCH_MODE ('auto'), which is why nothing here
 * declares a default — a client-side one would make that env var dead config.
 */

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
 * `ref` is the citation token used inline in the answer ('M3', 'D2', 'L1',
 * 'G1', 'W1'), stable only within the answer it came with. The document fields are
 * absent on meeting/live/semantic hits and the meeting fields are absent on
 * document/semantic hits. A 'live' hit is a line from the meeting currently
 * being recorded — it has no meetingId/date yet because it hasn't been
 * persisted as a completed meeting record. A 'semantic' hit is a glossary
 * term (Meeting Semantic Memory plan §06) — it has no meetingId/date because
 * it's cross-meeting knowledge by design, not tied to any single meeting.
 * A 'web' hit is a page the model retrieved itself during generation — it has
 * no meetingId, no date and no speaker, and carries a title and url instead.
 * Unlike every other source type it was never retrieved by the evidence
 * pipeline, so it has no score and no rank either.
 */
export interface ChatSource {
  ref?: string;
  sourceType?: 'meeting' | 'document' | 'live' | 'semantic' | 'web';
  meetingId?: number;
  meetingName?: string;
  date?: string;
  speaker?: string;
  snippet?: string;
  sourceTable?: string;
  docId?: string;
  fileName?: string;
  pageNumber?: number | null;
  /** Web hits only: the page title and its address. */
  title?: string;
  url?: string;
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
  /** Which mode produced this answer, echoed by the sidecar. */
  mode?: ChatMode;
  /** Which web mode this answer was asked in, echoed by the sidecar. */
  webMode?: WebMode;
  /**
   * Whether the model ACTUALLY searched, counted from the provider's own
   * tool-call items rather than guessed from the prose. Distinct from
   * webMode: in 'auto' most turns come back false, which is the point.
   */
  usedWebSearch?: boolean;
  webSearchCount?: number;
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
  /**
   * The mode this turn was answered in. Kept per message, not per thread, so
   * a thread that mixes both stays readable after the switch is flipped —
   * an answer with no source cards is a direct answer, not a failed search.
   */
  mode?: ChatMode;
  /**
   * Whether this particular answer was checked against the web. Also kept per
   * message, and for a sharper version of the same reason: with the Web switch
   * on, most answers still will not have searched, so the switch's position
   * says nothing about any individual reply.
   */
  usedWebSearch?: boolean;
}
