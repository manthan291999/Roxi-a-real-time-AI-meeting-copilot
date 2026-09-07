import { useState, useEffect, useCallback, useRef } from 'react';
import { useServices } from '../../context';
import { ChatMessage, ChatThreadId } from '../../shared/types';

/**
 * One chat thread: its message history, its pending state, and its own event
 * subscriptions.
 *
 * Previously `useChat` and `useHistoryChat` were near-identical copies of this,
 * differing only in the threadId they sent. Both subscribed to the same global
 * `chat_reply` / `chat_thinking` / `chat_error` events with no filter, and both
 * providers were mounted at once, so **every answer was appended to both
 * threads**. The `accepts()` guard below is what closes that.
 */
export function useChatThread(threadId: ChatThreadId) {
  const { chatService, eventBus } = useServices();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [thinkingNode, setThinkingNode] = useState('');

  /**
   * Whether this thread is waiting on a reply. Read inside event handlers, so
   * it lives in a ref rather than state — a stale closure would misroute.
   */
  const pendingRef = useRef(false);

  /**
   * Does an incoming event belong to this thread?
   *
   * Responses carry `threadId` once the protocol stamps it. Until then they
   * carry none, and the sidecar processes one Ask at a time, so the thread
   * actually awaiting a reply is the correct recipient. Correct either way.
   */
  const accepts = useCallback(
    (eventThreadId?: string | null) =>
      eventThreadId == null ? pendingRef.current : eventThreadId === threadId,
    [threadId],
  );

  useEffect(() => {
    const settle = () => {
      pendingRef.current = false;
      setIsLoading(false);
      setThinkingNode('');
    };

    const unlistenReply = eventBus.onChatReply((reply) => {
      if (!accepts(reply?.threadId)) return;
      settle();

      // The payload is { answer, sources, followUps, clarifyingQuestion, ... }.
      // On the clarify route `answer` is empty and the question lives in
      // `clarifyingQuestion`, so it has to be part of the fallback chain —
      // otherwise the bubble rendered a JSON dump.
      const content = reply?.answer || reply?.clarifyingQuestion || '';

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: content || 'No answer was produced for that question.',
          sources: reply?.sources,
          followUps: reply?.followUps,
          clarifyingQuestion: reply?.clarifyingQuestion,
        },
      ]);
    });

    const unlistenThinking = eventBus.onChatThinking((event) => {
      if (!accepts(typeof event === 'string' ? undefined : event?.threadId)) return;
      setThinkingNode(typeof event === 'string' ? event : event?.node || '');
    });

    const unlistenError = eventBus.onChatError((err) => {
      if (!accepts(err?.threadId)) return;
      settle();
      const message = err?.message || 'Unknown error';
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${message}` }]);
    });

    return () => {
      unlistenReply();
      unlistenThinking();
      unlistenError();
    };
  }, [eventBus, accepts]);

  const askQuestion = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed) return;

      // Snapshot before appending: the sidecar wants the turns BEFORE this one.
      const history = messages;
      setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
      pendingRef.current = true;
      setIsLoading(true);
      setThinkingNode('');

      try {
        await chatService.ask(trimmed, threadId, history);
      } catch (err) {
        pendingRef.current = false;
        setIsLoading(false);
        setThinkingNode('');
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Failed to send: ${err}` },
        ]);
      }
    },
    [chatService, messages, threadId],
  );

  const clearChat = useCallback(() => setMessages([]), []);

  return { threadId, messages, isLoading, thinkingNode, askQuestion, clearChat };
}

export type ChatThreadState = ReturnType<typeof useChatThread>;
