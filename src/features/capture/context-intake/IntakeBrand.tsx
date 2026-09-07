import React from 'react';
import { tokens } from '../../../design-system';

const MARK_BARS = [8, 14, 10, 6];

/** "Roxi AI" lockup for the intake modal. */
export const IntakeBrand: React.FC = () => (
  <div className="flex items-center gap-2.5 select-none">
    <div className="flex items-end gap-[2px] h-[14px]" aria-hidden="true">
      {MARK_BARS.map((height, index) => (
        <span
          key={index}
          className="w-[3px] rounded-full"
          style={{ height, backgroundColor: tokens.signal }}
        />
      ))}
    </div>
    <span className="text-[17px] font-bold tracking-tight" style={{ color: tokens.paper }}>
      Roxi <span style={{ color: tokens.signal }}>AI</span>
    </span>
  </div>
);
