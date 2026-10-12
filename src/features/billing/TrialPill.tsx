import React from 'react';
import { tokens, typeScale } from '../../design-system';
import { formatElapsed, useElapsed } from '../session/useElapsed';
import { useTrial } from './TrialContext';

/**
 * Trial time left, in the header. Counts down locally while live from the
 * figure loaded before the capture started; the backend stops the capture
 * itself, so a drift of a second or two here never matters.
 */
export const TrialPill: React.FC<{ isLive: boolean }> = ({ isLive }) => {
  const { status, isExhausted, openUpgrade } = useTrial();
  const elapsed = useElapsed(isLive);
  if (!status || status.unlimited) return null;

  const remaining = Math.max(0, status.remainingSeconds - (isLive ? elapsed : 0));
  const low = isExhausted || remaining <= 60;
  const text = isExhausted ? 'Trial ended' : `Trial ${formatElapsed(remaining)} left`;

  return (
    <button
      type="button"
      onClick={openUpgrade}
      aria-label={`${text}. See plans`}
      className="roxi-status-pill flex items-center rounded-full px-2.5 py-1 mr-1 whitespace-nowrap tabular-nums hover:brightness-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]"
      style={{
        backgroundColor: low ? tokens.riskBg : tokens.signalDim,
        color: low ? tokens.risk : tokens.signal,
        fontSize: typeScale.label.fontSize,
        fontWeight: typeScale.label.fontWeight,
      }}
    >
      {text}
    </button>
  );
};
