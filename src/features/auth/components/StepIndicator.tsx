import React from 'react';
import { CheckIcon, tokens, typeScale } from '../../../design-system';

type StepState = 'done' | 'current' | 'upcoming';

const stepState = (index: number, current: number): StepState =>
  index < current ? 'done' : index === current ? 'current' : 'upcoming';

/** A short numbered progress row: done steps get a check, the current one is highlighted. */
export const StepIndicator: React.FC<{ steps: readonly string[]; current: number }> = ({ steps, current }) => (
  <ol className="flex items-center gap-2.5" aria-label={`Step ${current + 1} of ${steps.length}`}>
    {steps.map((label, index) => {
      const state = stepState(index, current);
      return (
        <React.Fragment key={label}>
          {index > 0 && (
            <li aria-hidden="true" className="flex-1 h-px" style={{ background: state === 'upcoming' ? tokens.hairline : tokens.signal }} />
          )}
          <li
            className="flex items-center gap-2"
            aria-current={state === 'current' ? 'step' : undefined}
            style={{ fontSize: typeScale.caption.fontSize, fontWeight: 600, color: state === 'upcoming' ? tokens.muteDim : state === 'current' ? tokens.signal : tokens.paper }}
          >
            <StepDot state={state} number={index + 1} />
            {label}
          </li>
        </React.Fragment>
      );
    })}
  </ol>
);

const StepDot: React.FC<{ state: StepState; number: number }> = ({ state, number }) => {
  if (state === 'done') {
    return (
      <span className="w-[22px] h-[22px] rounded-full flex items-center justify-center" style={{ background: tokens.signal, color: tokens.onSignal }}>
        <CheckIcon className="w-3 h-3" />
      </span>
    );
  }
  return (
    <span
      className="w-[22px] h-[22px] rounded-full flex items-center justify-center border text-[11px]"
      style={
        state === 'current'
          ? { borderColor: tokens.signal, background: tokens.signalDim, color: tokens.signal }
          : { borderColor: tokens.neutralLine, color: tokens.muteDim }
      }
    >
      {number}
    </span>
  );
};
