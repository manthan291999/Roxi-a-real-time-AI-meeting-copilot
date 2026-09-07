import React, { useRef, useEffect } from 'react';
import { ChatThreadId } from '../../shared/types';
import { useChatThreadContext } from './ChatThreadProvider';
import { ChatInput } from './ChatInput';
import { RoxiAnswerCard } from './components/RoxiAnswerCard';
import { ThinkingIndicator } from './components/ThinkingIndicator';
import { UserBubble } from './components/UserBubble';
import { tokens } from '../../design-system';

interface ChatPaneProps {
  /** Which thread this pane is a view of. */
  threadId: ChatThreadId;
  emptyHint?: string;
}

/**
 * One chat thread, rendered. Composition only — every rule lives in
 * useChatThread, so the Ask tab and the history browser share this pane
 * instead of the two near-identical copies they used to have.
 */
export const ChatPane: React.FC<ChatPaneProps> = ({
  threadId,
  emptyHint = 'Ask a question about the meeting…',
}) => {
  const { messages, isLoading, thinkingNode, askQuestion } = useChatThreadContext(threadId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, thinkingNode]);

  return (
    <div className="flex flex-col h-full" style={{ background: tokens.panel }}>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 custom-scrollbar">
        {messages.length === 0 ? (
          <div
            className="h-full flex flex-col items-center justify-center italic text-[14px]"
            style={{ color: tokens.muteDim }}
          >
            {emptyHint}
          </div>
        ) : (
          messages.map((msg, i) =>
            msg.role === 'assistant' ? (
              <RoxiAnswerCard key={i} message={msg} onFollowUpClick={askQuestion} />
            ) : (
              <UserBubble key={i} content={msg.content} />
            ),
          )
        )}

        {isLoading && <ThinkingIndicator nodeName={thinkingNode} />}
        <div ref={bottomRef} className="h-4 shrink-0" />
      </div>

      <ChatInput onSend={askQuestion} isLoading={isLoading} />
    </div>
  );
};
