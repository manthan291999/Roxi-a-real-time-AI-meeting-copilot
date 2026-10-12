import React, { useEffect } from 'react';
import { tokens, typeScale, radius, CheckIcon, CloseIcon } from '../../design-system';
import { openExternalUrl } from '../../services/externalLinks';
import { Plan, PLANS, TRIAL_MINUTES, checkoutUrl, formatPrice } from './plans';
import { useTrial } from './TrialContext';

const PlanCard: React.FC<{ plan: Plan; isCurrent: boolean }> = ({ plan, isCurrent }) => {
  const url = plan.id === 'free' ? null : checkoutUrl(plan.id);
  const label = isCurrent ? 'Current plan' : plan.id === 'enterprise' ? 'Contact sales' : `Choose ${plan.name}`;

  return (
    <article
      className="relative flex flex-col gap-3 p-4 border"
      style={{
        borderRadius: radius.control + 2,
        background: tokens.card,
        borderColor: plan.recommended ? tokens.signal : tokens.hairline,
        boxShadow: plan.recommended ? `0 0 0 1px ${tokens.signal}` : tokens.cardInset,
      }}
    >
      <header className="flex items-center gap-2">
        <h3 className="flex-1 text-[14px] font-semibold" style={{ color: tokens.paper }}>{plan.name}</h3>
        {plan.recommended && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded" style={{ background: tokens.signalDim, color: tokens.signal }}>
            Popular
          </span>
        )}
      </header>
      <div>
        <span className="text-[26px] font-bold tracking-[-0.02em]" style={{ color: tokens.paper }}>{formatPrice(plan.pricePence)}</span>
        <p className="text-[12px]" style={{ color: tokens.mute }}>{plan.period}</p>
      </div>
      <ul className="flex flex-col gap-1.5 flex-1">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-1.5 text-[12px] leading-snug" style={{ color: tokens.paper }}>
            <CheckIcon className="w-3.5 h-3.5 mt-px shrink-0" style={{ color: tokens.signal }} />
            {feature}
          </li>
        ))}
      </ul>
      {plan.id !== 'free' && (
        <button
          type="button"
          disabled={isCurrent || !url}
          onClick={() => openExternalUrl(url)}
          className="h-8 rounded-[8px] text-[13px] font-medium transition-[filter,transform] active:enabled:scale-[0.98] hover:enabled:brightness-[0.97] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]"
          style={
            plan.recommended
              ? { background: tokens.signal, color: tokens.onSignal, boxShadow: tokens.signalBevel }
              : { background: tokens.ink, color: tokens.paper, border: `1px solid ${tokens.hairline}` }
          }
        >
          {isCurrent || url ? label : 'Coming soon'}
        </button>
      )}
    </article>
  );
};

/**
 * The plans sheet. Opens when the trial runs out (or Start is pressed after
 * it has), and from the header pill and Settings › Plan at any time.
 */
export const UpgradeModal: React.FC = () => {
  const { status, isExhausted, isUpgradeOpen, closeUpgrade } = useTrial();

  useEffect(() => {
    if (!isUpgradeOpen) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && closeUpgrade();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isUpgradeOpen, closeUpgrade]);

  if (!isUpgradeOpen) return null;
  const current = status?.plan ?? 'free';

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: tokens.scrim, backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Choose a plan"
      onMouseDown={(event) => event.target === event.currentTarget && closeUpgrade()}
    >
      <div
        className="relative flex w-full max-w-[820px] max-h-full flex-col overflow-hidden animate-card-enter"
        style={{ borderRadius: radius.panel + 8, background: tokens.sheet, border: `1px solid ${tokens.hairline}`, boxShadow: tokens.sheetShadow }}
      >
        <div className="relative flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto custom-scrollbar px-6 pt-5 pb-6">
          <header className="flex items-start gap-3">
            <div className="flex-1 flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: tokens.signal }}>
                {isExhausted ? 'Free trial ended' : 'Plans'}
              </span>
              <h2 style={{ color: tokens.paper, fontSize: typeScale.display.fontSize, lineHeight: typeScale.display.lineHeight, fontWeight: typeScale.display.fontWeight }}>
                {isExhausted ? 'Keep Roxi in your meetings' : 'Choose the plan that fits'}
              </h2>
              <p className="text-[13px]" style={{ color: tokens.mute }}>
                {isExhausted
                  ? `You've used your ${TRIAL_MINUTES}-minute free trial. Your meetings so far are saved, and you can still browse them and ask Roxi about them.`
                  : 'Prices in pounds sterling, including VAT. Cancel at any time.'}
              </p>
            </div>
            <button
              type="button"
              onClick={closeUpgrade}
              aria-label="Close"
              className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center hover:bg-[var(--t-overlay-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--t-focus-ring)]"
              style={{ color: tokens.mute }}
            >
              <CloseIcon className="w-3.5 h-3.5" />
            </button>
          </header>
          <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
            {PLANS.map((plan) => (
              <PlanCard key={plan.id} plan={plan} isCurrent={plan.id === current} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
