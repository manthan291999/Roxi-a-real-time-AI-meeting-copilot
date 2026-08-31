import { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { ServicesContext } from '../../context/ServicesContext';
import { ChatReplyPayload, ChatSource, ChatTurn } from '../../interfaces/IChatService';

export interface ChatMessageVM {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: ChatSource[];
  clarifyingQuestion?: string;
  followUps?: string[];
  route?: string;
  /** Set while the answer is streaming in (graph node name). */
  thinkingNode?: string;
  error?: string;
}

/** Friendly labels for graph node progress events. */
export const NODE_LABELS: Record<string, string> = {
  analyze_query: 'Understanding your question…',
  retrieve: 'Searching meeting history…',
  grade_documents: 'Checking what is relevant…',
  rewrite_query: 'Broadening the search…',
  clarify: 'Preparing a clarifying question…',
  generate: 'Writing the answer…',
  respond_no_data: 'Wrapping up…',
};

let seq = 0;
const nextId = () => `msg-${Date.now()}-${seq++}`;

export function useChat() {
  const [messages, setMessages] = useState<ChatMessageVM[]>([]);
  const [thinking, setThinking] = useState(false);
  const [threadId] = useState(() => `ui-${Date.now()}`);

  const services = useContext(ServicesContext);
  const pendingIdRef = useRef<string | null>(null);
  const historyRef = useRef<ChatTurn[]>([]);

  // Subscribe to chat events once; route them into the pending message.
  useEffect(() => {
    if (!services) return;
    const unsubs: (() => void)[] = [];

    services.chatService.onThinking((node) => {
      const id = pendingIdRef.current;
      if (!id) return;
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, thinkingNode: node } : m)));
    }).then((u) => unsubs.push(u));

    services.chatService.onReply((payload: ChatReplyPayload) => {
      const id = pendingIdRef.current;
      pendingIdRef.current = null;
      setThinking(false);
      if (!id) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                text: payload.answer,
                sources: payload.sources,
                clarifyingQuestion: payload.clarifyingQuestion || undefined,
                followUps: payload.followUps,
                route: payload.route,
                thinkingNode: undefined,
              }
            : m
        )
      );
      if (payload.answer) {
        historyRef.current.push({ role: 'assistant', content: payload.answer });
      }
    }).then((u) => unsubs.push(u));

    services.chatService.onError((err) => {
      const id = pendingIdRef.current;
      pendingIdRef.current = null;
      setThinking(false);
      if (!id) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, text: '', error: err.message || 'Something went wrong.', thinkingNode: undefined }
            : m
        )
      );
    }).then((u) => unsubs.push(u));

    return () => unsubs.forEach((u) => u());
  }, [services]);

  const send = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || thinking || !services) return;

      const userMsg: ChatMessageVM = { id: nextId(), role: 'user', text: q };
      const placeholder: ChatMessageVM = {
        id: nextId(),
        role: 'assistant',
        text: '',
        thinkingNode: 'analyze_query',
      };
      pendingIdRef.current = placeholder.id;
      historyRef.current.push({ role: 'user', content: q });
      setMessages((prev) => [...prev, userMsg, placeholder]);
      setThinking(true);

      try {
        await services.chatService.ask(q, threadId, historyRef.current.slice(0, -1));
      } catch (err: any) {
        pendingIdRef.current = null;
        setThinking(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholder.id
              ? { ...m, error: String(err?.message || err), thinkingNode: undefined }
              : m
          )
        );
      }
    },
    [services, thinking, threadId]
  );

  const clear = useCallback(() => {
    setMessages([]);
    historyRef.current = [];
    pendingIdRef.current = null;
    setThinking(false);
  }, []);

  return { messages, thinking, send, clear };
}
