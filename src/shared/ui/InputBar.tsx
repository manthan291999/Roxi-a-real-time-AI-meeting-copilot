import React, { useState } from 'react';
import { tokens } from '../../design-system/tokens';
import { SendIcon, CloseIcon } from '../../design-system/icons';

interface InputBarProps {
  onSend: (text: string) => void;
  placeholder?: string;
  attachmentLabel?: string;
}

export const InputBar: React.FC<InputBarProps> = ({ 
  onSend, 
  placeholder = "Ask anything or paste a screenshot...", 
  attachmentLabel = "Your screen · Use image"
}) => {
  const [inputValue, setInputValue] = useState('');
  const [attachmentVisible, setAttachmentVisible] = useState(true);
  const canSend = inputValue.trim().length > 0;

  const handleSend = () => {
    if (!inputValue.trim()) return;
    onSend(inputValue.trim());
    setInputValue('');
  };

  return (
    <div className="mt-auto pt-3 pb-6 px-6 shrink-0 bg-transparent relative z-20">
      <div
        className="flex items-center gap-2 rounded-full pl-5 pr-2 py-1.5 border transition-colors"
        style={{
          backgroundColor: tokens.panelRaised,
          borderColor: tokens.hairline,
        }}
      >
        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSend();
          }}
          placeholder={placeholder}
          className="flex-1 bg-transparent border-none outline-none text-[14px] py-2"
          style={{ color: tokens.paper }}
        />
        <button
          type="button"
          onClick={handleSend}
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors cursor-pointer"
          style={{
            backgroundColor: canSend ? tokens.signal : tokens.panel,
            color: canSend ? '#fff' : tokens.muteDim,
          }}
          title="Send"
        >
          <SendIcon className="w-4 h-4" />
        </button>
      </div>

      {attachmentVisible && (
        <div
          className="mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1"
          style={{ borderColor: tokens.hairline, color: tokens.mute }}
        >
          <span className="text-[12px]">{attachmentLabel}</span>
          <button
            type="button"
            onClick={() => setAttachmentVisible(false)}
            className="transition-opacity hover:opacity-70 cursor-pointer"
            title="Remove attachment"
          >
            <CloseIcon className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
};
