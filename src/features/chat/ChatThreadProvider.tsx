import React, { createContext, useContext, useMemo } from 'react';
import { CHAT_THREAD_IDS, ChatThreadId } from '../../shared/types';
import { useChatThread, ChatThreadState } from './useChatThread';

type ThreadMap = Record<ChatThreadId, ChatThreadState>;

const ChatThreadsContext = createContext<ThreadMap | null>(null);

/**
 * Owns every chat thread for the widget.
 *
 * One provider holding a map, rather than one nested provider per thread:
 * panes mount and unmount as tabs change, so thread state has to live above
 * them, and two nested providers of the same context would shadow each other.
 * The thread list is a static tuple, so the hooks below are called
 * unconditionally in a fixed order.
 *
 * Adding a thread is one entry in CHAT_THREAD_IDS plus one line here.
 */
export const ChatThreadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const ask = useChatThread('ask');
  const history = useChatThread('history');

  const value = useMemo<ThreadMap>(() => ({ ask, history }), [ask, history]);

  return <ChatThreadsContext.Provider value={value}>{children}</ChatThreadsContext.Provider>;
};

/** The state for one thread. Throws if used outside the provider. */
export function useChatThreadContext(threadId: ChatThreadId): ChatThreadState {
  const threads = useContext(ChatThreadsContext);
  if (!threads) {
    throw new Error('useChatThreadContext must be used within a ChatThreadProvider');
  }
  const thread = threads[threadId];
  if (!thread) {
    throw new Error(
      `Unknown chat thread "${threadId}". Known threads: ${CHAT_THREAD_IDS.join(', ')}`,
    );
  }
  return thread;
}
