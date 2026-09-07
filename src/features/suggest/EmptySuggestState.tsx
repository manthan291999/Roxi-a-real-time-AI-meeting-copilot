import React from 'react';
import { tokens, Waveform } from '../../design-system';

export const EmptySuggestState: React.FC = () => (
  <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
    <Waveform variant="live" />
    <div className="flex flex-col gap-2">
      <h3 className="text-[16px] font-medium" style={{ color: tokens.paper }}>
        Listening...
      </h3>
      <p className="text-[13px] max-w-[280px] leading-relaxed" style={{ color: tokens.mute }}>
        Roxi is analyzing the conversation. Answers and suggestions will appear here automatically.
      </p>
    </div>
  </div>
);
