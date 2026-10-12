import React from 'react';
import { tokens } from '../../design-system';
import { formatElapsed } from '../session/useElapsed';
import { TRIAL_MINUTES } from './plans';
import { useTrial } from './TrialContext';

/** One line on the ready screen: how much trial is left, or that it has ended. */
export const TrialNotice: React.FC = () => {
  const { status, isExhausted, openUpgrade } = useTrial();
  if (!status || status.unlimited) return null;

  return (
    <p className="text-[13px] text-center" style={{ color: isExhausted ? tokens.risk : tokens.mute }}>
      {isExhausted
        ? `Your ${TRIAL_MINUTES}-minute free trial has ended.`
        : `Free trial: ${formatElapsed(status.remainingSeconds)} of live capture left.`}{' '}
      <button
        type="button"
        onClick={openUpgrade}
        className="font-medium hover:underline rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--t-focus-ring)]"
        style={{ color: tokens.signal }}
      >
        {isExhausted ? 'Choose a plan' : 'See plans'}
      </button>
    </p>
  );
};
