import React from 'react';
import { LockIcon, radius, tokens, typeScale } from '../../../design-system';
import { OAuthProviderId, SignInMethods } from '../../../shared/types/account';
import { PROVIDER_CATALOG } from './providerCatalog';

interface FederatedOptionsProps {
  methods: SignInMethods;
  onProvider: (provider: OAuthProviderId) => void;
  onCompanySso: () => void;
  disabled: boolean;
}

/**
 * The browser sign-in buttons and the "or with email" divider. Renders
 * nothing when this build offers no browser sign-in.
 */
export const FederatedOptions: React.FC<FederatedOptionsProps> = ({ methods, onProvider, onCompanySso, disabled }) => {
  const count = methods.providers.length + (methods.companySso ? 1 : 0);
  if (count === 0) return null;
  return (
    <div className="flex flex-col gap-5">
      <div className={`grid gap-2.5 ${count === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {methods.providers.map((id) => {
          const { label, mark: Mark } = PROVIDER_CATALOG[id];
          return (
            <OptionButton key={id} onClick={() => onProvider(id)} disabled={disabled} ariaLabel={`Continue with ${label}`}>
              <Mark />
              {label}
            </OptionButton>
          );
        })}
        {methods.companySso && (
          <OptionButton onClick={onCompanySso} disabled={disabled} ariaLabel="Sign in with company SSO">
            <LockIcon className="w-4 h-4" />
            Company SSO
          </OptionButton>
        )}
      </div>
      <div className="flex items-center gap-3" style={{ color: tokens.muteDim, fontSize: typeScale.caption.fontSize }}>
        <span className="flex-1 h-px" style={{ background: tokens.hairline }} />
        or with email
        <span className="flex-1 h-px" style={{ background: tokens.hairline }} />
      </div>
    </div>
  );
};

const OptionButton: React.FC<{ children: React.ReactNode; onClick: () => void; disabled: boolean; ariaLabel: string }> = ({
  children,
  onClick,
  disabled,
  ariaLabel,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={ariaLabel}
    className="inline-flex items-center justify-center gap-2.5 border text-[14px] font-semibold transition-colors hover:enabled:bg-[var(--t-overlay-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
    style={{ height: 44, borderRadius: radius.control, borderColor: tokens.hairline, background: tokens.card, color: tokens.paper }}
  >
    {children}
  </button>
);
