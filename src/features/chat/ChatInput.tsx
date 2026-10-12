import React, { useState, useEffect } from 'react';
import { tokens, radius, ArrowUpIcon, PaperclipIcon } from '../../design-system';

interface ChatInputProps {
  onSend: (text: string) => void;
  isLoading: boolean;
  onUpload?: () => void;
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
 * The single chat composer, shared by the Ask tab and the history browser:
 * rotating placeholder, focus ring, ↵ to send and ⇧↵ for a new line.
 */
export const ChatInput: React.FC<ChatInputProps> = ({ onSend, isLoading = false, onUpload }) => {
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
    <div className="px-4 pt-2 pb-3">
      <div
        className="flex items-end gap-1 p-1.5 border transition-[border-color,box-shadow] duration-200"
        style={{
          background: tokens.card,
          borderColor: isFocused ? tokens.signalLine : tokens.hairline,
          borderRadius: radius.card,
          boxShadow: isFocused ? `0 0 0 4px ${tokens.signalFocus}` : tokens.cardInset,
        }}
      >
        {onUpload && (
          <button
            type="button"
            onClick={onUpload}
            disabled={isLoading}
            aria-label="Attach a document"
            title="Attach a PDF or TXT file"
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-[8px] transition-colors hover:enabled:bg-[var(--t-overlay-hover)] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--t-focus-ring)]"
            style={{ color: tokens.mute }}
          >
            <PaperclipIcon className="w-4 h-4" />
          </button>
        )}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={PLACEHOLDERS[placeholderIdx]}
          aria-label="Ask Roxi"
          className="flex-1 min-w-0 max-h-[120px] self-center bg-transparent px-1.5 py-1.5 text-[13px] leading-[20px] resize-none focus:outline-none custom-scrollbar placeholder:text-[var(--t-mute)]"
          style={{ color: tokens.paper }}
          rows={1}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send"
          title="Send (↵)"
          className="w-8 h-8 shrink-0 flex items-center justify-center rounded-[8px] transition-[background-color,transform] duration-150 active:enabled:scale-[0.94] disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]"
          style={{
            background: canSend ? tokens.signal : tokens.panelRaised,
            color: canSend ? tokens.onSignal : tokens.muteDim,
            boxShadow: canSend ? tokens.signalBevel : 'none',
          }}
        >
          <ArrowUpIcon className="w-4 h-4" />
        </button>
      </div>
      <p className="mt-1.5 px-1 text-[11px]" style={{ color: tokens.mute }}>
        ↵ to send · ⇧↵ for a new line
      </p>
    </div>
  );
};
