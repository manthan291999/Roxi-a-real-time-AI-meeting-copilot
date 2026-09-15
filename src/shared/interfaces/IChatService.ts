import { ChatMessage, ChatMode, WebMode } from '../types';

/**
 * Everything an Ask carries besides the question itself.
 *
 * An options object rather than a fifth positional parameter: the call is
 * already four arguments deep, and every field here is optional, so a bag
 * keeps call sites readable and lets the next one be added without touching
 * the ones that don't care.
 */
export interface AskOptions {
  threadId?: string;
  history?: ChatMessage[];
  /**
   * Recent lines from the meeting currently being recorded, if any — bridges
   * the gap before those lines are indexed for search. Ignored in 'direct'
   * mode, where nothing from the meeting is consulted.
   */
  liveContext?: string;
  /** Defaults to 'rag'. Omitting it must never turn search off. */
  mode?: ChatMode;
  /**
   * Whether this turn may reach the web, independent of `mode`. Omitting it
   * leaves the choice to the sidecar's configured default rather than forcing
   * one here — the host and the CLI are senders too.
   */
  webMode?: WebMode;
}

export interface IChatService {
  ask(question: string, options?: AskOptions): Promise<void>;
  close(): Promise<void>;
}
