import React, { createContext, useContext } from 'react';
import { useHistoryChat } from './useHistoryChat';

type HistoryChatState = ReturnType<typeof useHistoryChat>;

const HistoryChatContext = createContext<HistoryChatState | null>(null);

export const HistoryChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const chat = useHistoryChat();
  return <HistoryChatContext.Provider value={chat}>{children}</HistoryChatContext.Provider>;
};

export function useHistoryChatContext(): HistoryChatState {
  const chat = useContext(HistoryChatContext);
  if (!chat) throw new Error('useHistoryChatContext must be used within a HistoryChatProvider');
  return chat;
}
