import React from 'react';
import { tokens } from '../../../design-system';

interface IntakeSectionProps {
  step: number;
  title: string;
  /** Right-aligned note — "Optional", a counter, or an action. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}

/** A numbered group in the intake sheet: step badge, title, optional aside, then the control. */
export const IntakeSection: React.FC<IntakeSectionProps> = ({ step, title, aside, children }) => (
  <section className="flex shrink-0 flex-col gap-2.5">
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold"
        style={{ background: tokens.signalDim, color: tokens.signal, border: `1px solid ${tokens.signalLine}` }}
      >
        {step}
      </span>
      <h3 className="flex-1 text-[14px] font-semibold tracking-tight" style={{ color: tokens.paper }}>
        {title}
      </h3>
      {aside}
    </div>
    {children}
  </section>
);

/** The quiet "Optional" note that sits in an IntakeSection's aside slot. */
export const OptionalNote: React.FC = () => (
  <span className="text-[12px]" style={{ color: tokens.muteDim }}>
    Optional
  </span>
);
