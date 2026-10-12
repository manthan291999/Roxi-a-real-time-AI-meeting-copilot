import React from 'react';
import { SettingsGroup, SettingsRow, RowValue, SettingsButton, StatusValue } from '../settings/settingsUi';
import { formatElapsed } from '../session/useElapsed';
import { PLANS, TRIAL_MINUTES, formatPrice, planName } from './plans';
import { useTrial } from './TrialContext';

/** Settings › Plan & Billing: the current plan, trial time left, and prices. */
export const PlanSection: React.FC = () => {
  const { status, isExhausted, openUpgrade } = useTrial();
  const plan = status?.plan ?? 'free';

  return (
    <>
      <SettingsGroup
        title="Your plan"
        footer={status && !status.unlimited ? `The free trial gives each Mac ${TRIAL_MINUTES} minutes of live capture. Meetings you have already captured stay available after it ends.` : undefined}
      >
        <SettingsRow label="Plan" detail={status?.admin ? 'App owner or admin: every feature, no time limit' : undefined}>
          <RowValue>{status?.admin ? 'Admin · Full access' : status?.unlimited ? planName(plan) : 'Free trial'}</RowValue>
        </SettingsRow>
        {status && !status.unlimited && (
          <SettingsRow label="Trial time left" detail={`${formatElapsed(status.usedSeconds)} of ${formatElapsed(status.limitSeconds)} used`}>
            <StatusValue tone={isExhausted ? 'warn' : 'ok'}>{isExhausted ? 'Ended' : formatElapsed(status.remainingSeconds)}</StatusValue>
          </SettingsRow>
        )}
        <SettingsRow label={status?.unlimited ? 'Change plan' : 'Upgrade'} detail="Compare plans and prices">
          <SettingsButton tone={status?.unlimited ? 'default' : 'primary'} onClick={openUpgrade}>
            See Plans
          </SettingsButton>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Prices" footer="Prices in pounds sterling (GBP), including VAT.">
        {PLANS.filter((p) => p.id !== 'free').map((p) => (
          <SettingsRow key={p.id} label={p.name} detail={p.blurb}>
            <RowValue>
              {formatPrice(p.pricePence)}
              {p.pricePence !== null ? ` ${p.period}` : ''}
            </RowValue>
          </SettingsRow>
        ))}
      </SettingsGroup>
    </>
  );
};
