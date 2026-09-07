import { useState, useEffect, useCallback } from 'react';
import { useServices } from '../../context';
import { ChatMessage } from '../../shared/types';

export function useHistoryChat() {
  const { chatService, eventBus } = useServices();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [thinkingText, setThinkingText] = useState('');

  useEffect(() => {
    const unlistenReply = eventBus.onChatReply((msg) => {
      setIsLoading(false);
      setThinkingText('');
      // The chatbot protocol sends: { answer, sources, followUps, clarifyingQuestion, ... }
      // Safely extract the text — never fall through to the raw object which would throw
      // a React render error ("Objects are not valid as React children").
      const text: string =
        typeof msg === 'string'
          ? msg
          : msg?.answer || msg?.text || JSON.stringify(msg);
      setMessages(prev => [...prev, { role: 'assistant', content: text }]);
    });

    const unlistenThinking = eventBus.onChatThinking((text) => {
      setThinkingText(text);
    });

    const unlistenError = eventBus.onChatError((err) => {
      setIsLoading(false);
      setThinkingText('');
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err}` }]);
    });

    return () => {
      unlistenReply();
      unlistenThinking();
      unlistenError();
    };
  }, [eventBus]);

  const askQuestion = useCallback(async (question: string) => {
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setIsLoading(true);
    setThinkingText('Thinking...');
    
    try {
      await chatService.ask(question, 'history', messages);
    } catch (err) {
      setIsLoading(false);
      setThinkingText('');
      setMessages(prev => [...prev, { role: 'assistant', content: `Failed to send: ${err}` }]);
    }
  }, [chatService, messages]);

  const clearChat = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    isLoading,
    thinkingText,
    askQuestion,
    clearChat
  };
}
