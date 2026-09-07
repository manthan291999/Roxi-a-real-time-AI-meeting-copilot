import React, { useState } from 'react';
import { IconButton, tokens, radius } from '../../design-system';
import { SendIcon } from '../../design-system/icons';

interface ChatInputProps {
  onSend: (text: string) => void;
  isLoading: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, isLoading }) => {
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    onSend(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = input.trim().length > 0 && !isLoading;

  return (
    <div className="p-4 border-t" style={{ borderColor: tokens.hairline, background: tokens.panel }}>
      <div
        className="relative flex items-end overflow-hidden transition-colors"
        style={{ background: tokens.panelRaised, border: `1px solid ${tokens.hairline}`, borderRadius: radius.panel }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Roxi about the meeting…"
          className="flex-1 max-h-[120px] bg-transparent text-[14px] p-3 resize-none focus:outline-none custom-scrollbar placeholder:text-[#6F6F79]"
          style={{ color: tokens.paper }}
          rows={1}
        />
        <div className="p-2 shrink-0">
          <IconButton
            icon={<SendIcon />}
            onClick={handleSend}
            active={canSend}
            className={!canSend ? 'opacity-50 pointer-events-none' : ''}
          />
        </div>
      </div>
    </div>
  );
};
