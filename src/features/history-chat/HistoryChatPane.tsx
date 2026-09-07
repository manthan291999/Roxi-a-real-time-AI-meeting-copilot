import React, { useRef, useEffect } from 'react';
import { useHistoryChatContext } from './HistoryChatContext';
import { HistoryChatInput } from './HistoryChatInput';
import { RoxiAnswerCard } from './components/RoxiAnswerCard';
import { ThinkingIndicator } from './components/ThinkingIndicator';
import { tokens, radius } from '../../design-system';
import { ChatMessage } from '../../shared/types';

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
            msg.role === 'assistant' ? (
              <RoxiAnswerCard key={i} message={msg} onFollowUpClick={askQuestion} />
            ) : (
              <div key={i} className="flex w-full justify-end">
                <div
                  className="max-w-[85%] p-3 text-[14px] leading-relaxed rounded-br-sm"
                  style={{
                    borderRadius: radius.card,
                    background: tokens.signal,
                    color: '#fff',
                  }}
                >
                  {msg.content}
                </div>
              </div>
            )
          ))
        )}

        {isLoading && <ThinkingIndicator nodeName={thinkingText} />}
        <div ref={bottomRef} className="h-4 shrink-0" />
      </div>

      <HistoryChatInput onSend={askQuestion} isLoading={isLoading} />
    </div>
  );
};
