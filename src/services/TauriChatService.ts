import { invoke } from '@tauri-apps/api/core';
import { AskOptions, IChatService } from '../shared/interfaces';
import { DEFAULT_CHAT_MODE } from '../shared/types';

export class TauriChatService implements IChatService {
  async ask(
    question: string,
    { threadId, history, liveContext, mode = DEFAULT_CHAT_MODE, webMode }: AskOptions = {},
  ): Promise<void> {
    // webMode has NO default here on purpose. The UI never sets it, so an
    // absent value must travel all the way to the sidecar as absent, where
    // its configured default ('auto') applies. Defaulting it in the client
    // would make CHATBOT_WEB_SEARCH_MODE dead config.
    await invoke('ask_chat', { question, threadId, history, liveContext, mode, webMode });
  }

  async close(): Promise<void> {
    await invoke('close_chat');
  }
}
