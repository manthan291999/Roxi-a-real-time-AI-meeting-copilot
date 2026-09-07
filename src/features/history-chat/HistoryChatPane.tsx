import React, { useRef, useEffect } from 'react';
import { useHistoryChatContext } from './HistoryChatContext';
import { MessageBubble } from '../chat/MessageBubble';
import { HistoryChatInput } from './HistoryChatInput';
import { tokens, radius } from '../../design-system';

export const HistoryChatPane: React.FC = () => {
  const { messages, isLoading, thinkingText, askQuestion } = useHistoryChatContext();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, thinkingText]);

  return (
    <div className="flex flex-col h-full" style={{ background: tokens.panel }}>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 custom-scrollbar">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center italic text-[14px]" style={{ color: tokens.muteDim }}>
            Ask a question about the meeting...
          </div>
        ) : (
          messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} />
          ))
        )}

        {isLoading && (
          <div className="flex w-full justify-start">
            <div
              className="max-w-[85%] p-3 text-[14px] rounded-bl-sm border flex items-center gap-2"
              style={{ borderRadius: radius.card, background: tokens.panelRaised, borderColor: tokens.hairline, color: tokens.paper }}
            >
              <span className="w-1.5 h-1.5 rounded-full animate-typing-dot" style={{ background: tokens.signal }}></span>
              <span className="w-1.5 h-1.5 rounded-full animate-typing-dot" style={{ background: tokens.signal }}></span>
              <span className="w-1.5 h-1.5 rounded-full animate-typing-dot" style={{ background: tokens.signal }}></span>
              <span className="ml-1 text-[12px]" style={{ color: tokens.mute }}>{thinkingText}</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} className="h-4 shrink-0" />
      </div>

      <HistoryChatInput onSend={askQuestion} isLoading={isLoading} />
    </div>
  );
};
