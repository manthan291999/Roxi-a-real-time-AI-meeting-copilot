import { useState, useEffect, useCallback } from 'react';
import { useServices } from '../../context';
import { ChatMessage } from '../../shared/types';

export function useChat() {
  const { chatService, eventBus } = useServices();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [thinkingText, setThinkingText] = useState('');

  useEffect(() => {
    const unlistenReply = eventBus.onChatReply((msg) => {
      setIsLoading(false);
      setThinkingText('');
      setMessages(prev => [...prev, { role: 'assistant', content: msg.text || msg }]);
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
      await chatService.ask(question, undefined, messages);
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
