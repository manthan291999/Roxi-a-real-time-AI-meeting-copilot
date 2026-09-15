import { useState, useEffect, useCallback, useRef } from 'react';
import { useServices } from '../../context';
import {
  ChatMessage,
  ChatMode,
  ChatThreadId,
  DEFAULT_CHAT_MODE,
} from '../../shared/types';

/** Where a thread's Knowledge preference is remembered, per thread. */
const modeStorageKey = (threadId: ChatThreadId) => `roxi.chat.mode.${threadId}`;

/**
 * The stored preference, or the default.
 *
 * Storage can be unavailable or throw (private window, cleared site data), and
 * it is only ever a convenience — searching is the safe answer when the
 * preference cannot be read, so every failure falls back to it.
 */
function readStoredMode(threadId: ChatThreadId): ChatMode {
  try {
    return localStorage.getItem(modeStorageKey(threadId)) === 'direct'
      ? 'direct'
      : DEFAULT_CHAT_MODE;
  } catch {
    return DEFAULT_CHAT_MODE;
  }
}

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
   * The Knowledge switch for THIS thread. Thread-scoped rather than global:
   * the Ask tab and the history browser answer different kinds of question,
   * and a user who turns retrieval off in one has said nothing about the
   * other.
   */
  const [mode, setMode] = useState<ChatMode>(() => readStoredMode(threadId));

  useEffect(() => {
    setMode(readStoredMode(threadId));
  }, [threadId]);

  useEffect(() => {
    try {
      localStorage.setItem(modeStorageKey(threadId), mode);
    } catch {
      /* Preference is a convenience; losing it must never break the chat. */
    }
  }, [threadId, mode]);

  /**
   * Whether this thread is waiting on a reply. Read inside event handlers, so
   * it lives in a ref rather than state — a stale closure would misroute.
   */
  const pendingRef = useRef(false);

  /**
   * Is this event addressed to this thread?
   *
   * Responses carry `threadId` once the protocol stamps it. Until then they
   * carry none, and the sidecar processes one Ask at a time, so the thread
   * actually awaiting a reply is the correct recipient. Correct either way.
   */
  const addressedToThread = useCallback(
    (eventThreadId?: string | null) =>
      eventThreadId == null ? pendingRef.current : eventThreadId === threadId,
    [threadId],
  );

  /**
   * A terminal event — the answer, or the error standing in for it — is
   * accepted only while this thread is actually waiting for one.
   *
   * One question produces exactly one answer bubble. Addressing alone does not
   * say that: a `chat_reply` stamped with this thread's id matches every time
   * it is delivered, so a duplicate delivery appended a second identical
   * answer. `pendingRef` is cleared by the first terminal event, which makes
   * the second a no-op regardless of why the transport repeated itself.
   */
  const acceptsTerminal = useCallback(
    (eventThreadId?: string | null) => pendingRef.current && addressedToThread(eventThreadId),
    [addressedToThread],
  );

  useEffect(() => {
    const settle = () => {
      pendingRef.current = false;
      setIsLoading(false);
      setThinkingNode('');
    };

    const unlistenReply = eventBus.onChatReply((reply) => {
      if (!acceptsTerminal(reply?.threadId)) return;
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
          // The sidecar echoes the mode it actually answered in; trust that
          // over local state, which the user may have flipped since asking.
          mode: reply?.mode ?? DEFAULT_CHAT_MODE,
          // Whether this answer was actually checked against the web, which
          // is not the same as whether the switch was on.
          usedWebSearch: Boolean(reply?.usedWebSearch),
        },
      ]);
    });

    const unlistenThinking = eventBus.onChatThinking((event) => {
      // Progress, not terminal: many arrive per question, and they carry no
      // state worth guarding beyond belonging to this thread.
      if (!addressedToThread(typeof event === 'string' ? undefined : event?.threadId)) return;
      setThinkingNode(typeof event === 'string' ? event : event?.node || '');
    });

    const unlistenError = eventBus.onChatError((err) => {
      if (!acceptsTerminal(err?.threadId)) return;
      settle();
      const message = err?.message || 'Unknown error';
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${message}` }]);
    });

    return () => {
      unlistenReply();
      unlistenThinking();
      unlistenError();
    };
  }, [eventBus, addressedToThread, acceptsTerminal]);

  const askQuestion = useCallback(
    async (question: string, liveContext?: string) => {
      const trimmed = question.trim();
      if (!trimmed) return;

      // Snapshot before appending: the sidecar wants the turns BEFORE this one.
      const history = messages;
      setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
      pendingRef.current = true;
      setIsLoading(true);
      setThinkingNode('');

      try {
        // liveContext is dropped for a direct ask by the sidecar too — sent
        // as undefined here so the intent is visible at the call site.
        await chatService.ask(trimmed, {
          threadId,
          history,
          liveContext: mode === 'direct' ? undefined : liveContext,
          mode,
          // webMode is deliberately NOT sent. There is no Web switch: the
          // model is always offered the tool and decides for itself whether a
          // question needs it. Omitting the field lets the sidecar's own
          // configured default apply, which keeps CHATBOT_WEB_SEARCH_MODE in
          // the root .env working as the one kill switch.
        });
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
    [chatService, messages, threadId, mode],
  );

  const clearChat = useCallback(() => setMessages([]), []);

  return { threadId, messages, isLoading, thinkingNode, askQuestion, clearChat, mode, setMode };
}

export type ChatThreadState = ReturnType<typeof useChatThread>;
