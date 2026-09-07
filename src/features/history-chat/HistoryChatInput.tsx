import React, { useState, useEffect } from 'react';
import { IconButton, tokens, radius } from '../../design-system';
import { SendIcon } from '../../design-system/icons';

interface HistoryChatInputProps {
  onSend: (text: string) => void;
  isLoading: boolean;
}

const PLACEHOLDERS = [
  "Ask Roxi about the meeting…",
  "Summarize the key decisions…",
  "What were my action items?",
  "Find the discussion about ML…"
];

export const HistoryChatInput: React.FC<HistoryChatInputProps> = ({ onSend, isLoading = false }) => {
  const [input, setInput] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);

  useEffect(() => {
    if (isFocused) return;
    const interval = setInterval(() => {
      setPlaceholderIdx(prev => (prev + 1) % PLACEHOLDERS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [isFocused]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    onSend(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = input.trim().length > 0 && !isLoading;

  return (
    <div className="p-4 border-t" style={{ borderColor: tokens.hairline, background: tokens.panel }}>
      <div
        className="relative flex items-end overflow-hidden transition-all duration-300"
        style={{ 
          background: tokens.panelRaised, 
          border: `1px solid ${isFocused ? tokens.signal : tokens.hairline}`, 
          borderRadius: radius.panel,
          boxShadow: isFocused ? `0 0 0 1px ${tokens.signal}33` : 'none'
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={PLACEHOLDERS[placeholderIdx]}
          className="flex-1 max-h-[120px] bg-transparent text-[14px] p-3 resize-none focus:outline-none custom-scrollbar placeholder:text-[#6F6F79] transition-all"
          style={{ color: tokens.paper }}
          rows={1}
        />
        <div className="p-2 shrink-0 group relative">
          <IconButton
            icon={<SendIcon />}
            onClick={handleSend}
            active={canSend}
            className={!canSend ? 'opacity-50 pointer-events-none' : ''}
          />
          {/* Tooltip for keyboard shortcut */}
          <div className="absolute -top-8 right-0 bg-[#292932] text-[10px] text-[#A1A1AA] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-[#3f3f46]">
            ⌘↵ to send
          </div>
        </div>
      </div>
    </div>
  );
};
