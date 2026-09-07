import React from 'react';
import { ChatMessage } from '../../shared/types';
import { tokens, radius } from '../../design-system';

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] p-3 text-[14px] leading-relaxed ${isUser ? 'rounded-br-sm' : 'rounded-bl-sm border'}`}
        style={{
          borderRadius: radius.card,
          background: isUser ? tokens.signal : tokens.panelRaised,
          borderColor: isUser ? undefined : tokens.hairline,
          color: isUser ? '#fff' : tokens.paper,
        }}
      >
        {message.content}
      </div>
    </div>
  );
};
