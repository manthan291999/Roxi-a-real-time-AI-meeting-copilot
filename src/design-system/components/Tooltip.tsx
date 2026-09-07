import React, { useState } from 'react';
import { tokens } from '../tokens';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children }) => {
  const [show, setShow] = useState(false);

  return (
    <div 
      className="relative flex items-center justify-center"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div
          className="absolute bottom-full mb-2 px-2 py-1 border text-[11px] rounded shadow-lg whitespace-nowrap pointer-events-none z-50"
          style={{ background: tokens.panelRaised, borderColor: tokens.hairline, color: tokens.paper }}
        >
          {content}
        </div>
      )}
    </div>
  );
};
