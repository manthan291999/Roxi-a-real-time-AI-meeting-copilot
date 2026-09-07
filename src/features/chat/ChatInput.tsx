import React, { useState, useEffect } from 'react';
import { IconButton, tokens, radius } from '../../design-system';
import { SendIcon } from '../../design-system/icons';

interface ChatInputProps {
  onSend: (text: string) => void;
  isLoading: boolean;
}

/** Cycles while the field is unfocused, to suggest what Roxi can answer. */
const PLACEHOLDERS = [
  'Ask Roxi about the meeting…',
  'Summarize the key decisions…',
  'What were my action items?',
  'Find the discussion about ML…',
];

const PLACEHOLDER_INTERVAL_MS = 4000;

/**
 * The single chat composer. This is the polished variant that used to live
 * only in the history pane (rotating placeholder, focus ring, Cmd+Enter); the
 * plainer duplicate in this folder has been retired.
 */
export const ChatInput: React.FC<ChatInputProps> = ({ onSend, isLoading = false }) => {
  const [input, setInput] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);

  useEffect(() => {
    if (isFocused) return;
    const interval = setInterval(() => {
      setPlaceholderIdx((prev) => (prev + 1) % PLACEHOLDERS.length);
    }, PLACEHOLDER_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isFocused]);

  const canSend = input.trim().length > 0 && !isLoading;

  const handleSend = () => {
    if (!canSend) return;
    onSend(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const isSubmit = e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey);
    if (isSubmit) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="p-4 border-t" style={{ borderColor: tokens.hairline, background: tokens.panel }}>
      <div
        className="relative flex items-end overflow-hidden transition-all duration-300"
        style={{
          background: tokens.panelRaised,
          border: `1px solid ${isFocused ? tokens.signal : tokens.hairline}`,
          borderRadius: radius.panel,
          boxShadow: isFocused ? `0 0 0 1px ${tokens.signalFocus}` : 'none',
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={PLACEHOLDERS[placeholderIdx]}
          className="flex-1 max-h-[120px] bg-transparent text-[14px] p-3 resize-none focus:outline-none custom-scrollbar placeholder:text-[var(--t-mute-dim)] transition-all"
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
          <div className="absolute -top-8 right-0 bg-[var(--t-sheet)] backdrop-blur-md text-[10px] text-[var(--t-mute)] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-[var(--t-hairline)]">
            ⌘↵ to send
          </div>
        </div>
      </div>
    </div>
  );
};
