import { invoke } from '@tauri-apps/api/core';
import { IChatService } from '../shared/interfaces';
import { ChatMessage } from '../shared/types';

export class TauriChatService implements IChatService {
  async ask(question: string, threadId?: string, history?: ChatMessage[]): Promise<void> {
    await invoke('ask_chat', { question, threadId, history });
  }

  async close(): Promise<void> {
    await invoke('close_chat');
  }
}
