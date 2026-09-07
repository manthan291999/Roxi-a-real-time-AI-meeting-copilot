import React, { createContext, useContext } from 'react';
import { useChat } from '../features/chat/useChat';

type ChatState = ReturnType<typeof useChat>;

const ChatContext = createContext<ChatState | null>(null);

/**
 * Owns chat state for the whole widget.
 *
 * Chat has two entry points — the always-visible InputBar and the Ask tab — and
 * ChatPane unmounts whenever another tab is active. A single provider above both
 * keeps one message history and one set of event subscriptions, instead of each
 * caller of useChat getting its own isolated (and duplicately-subscribed) copy.
 */
export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const chat = useChat();
  return <ChatContext.Provider value={chat}>{children}</ChatContext.Provider>;
};

export function useChatContext(): ChatState {
  const chat = useContext(ChatContext);
  if (!chat) throw new Error('useChatContext must be used within a ChatProvider');
  return chat;
}
