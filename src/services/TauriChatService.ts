import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  IChatService,
  ChatReplyPayload,
  ChatErrorPayload,
  ChatTurn,
} from '../interfaces/IChatService';
import { IEventHandler, UnsubscribeFn } from '../interfaces/IEventBus';

export class TauriChatService implements IChatService {
  async ask(question: string, threadId: string, history: ChatTurn[]): Promise<void> {
    // snake_case args: Tauri auto-maps to the Rust command's snake_case params.
    return invoke('ask_chat', { question, threadId, history });
  }

  async close(): Promise<void> {
    return invoke('close_chat');
  }

  async onThinking(handler: IEventHandler<string>): Promise<UnsubscribeFn> {
    return listen<string>('chat_thinking', (e) => handler(e.payload));
  }

  async onReply(handler: IEventHandler<ChatReplyPayload>): Promise<UnsubscribeFn> {
    return listen<ChatReplyPayload>('chat_reply', (e) => handler(e.payload));
  }

  async onError(handler: IEventHandler<ChatErrorPayload>): Promise<UnsubscribeFn> {
    return listen<ChatErrorPayload>('chat_error', (e) => handler(e.payload));
  }
}
