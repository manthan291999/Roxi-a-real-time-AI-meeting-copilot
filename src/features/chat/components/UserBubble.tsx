import React from 'react';
import { tokens, radius } from '../../../design-system';

/** The user's own turn. Extracted from JSX that was inlined in the pane. */
export const UserBubble: React.FC<{ content: string }> = ({ content }) => (
  <div className="flex w-full justify-end animate-fade-in">
    <div
      className="max-w-[85%] p-3 text-[14px] leading-relaxed rounded-br-sm"
      style={{ borderRadius: radius.card, background: tokens.signal, color: '#fff' }}
    >
      {content}
    </div>
  </div>
);
