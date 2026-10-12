import React from 'react';
import { radius, tokens, typeScale } from '../../../design-system';
import { Spinner } from '../../../shared/ui/Spinner';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]';

export const PrimaryButton: React.FC<{
  children: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  type?: 'submit' | 'button';
  onClick?: () => void;
}> = ({ children, loading, disabled, type = 'submit', onClick }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={`w-full inline-flex items-center justify-center gap-2 text-[15px] font-semibold tracking-[-0.01em] transition-colors duration-200 hover:enabled:bg-[var(--t-signal-strong)] active:enabled:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`}
    style={{ height: 46, borderRadius: radius.control, background: tokens.signal, color: tokens.onSignal, boxShadow: tokens.signalBevel }}
  >
    {loading && <Spinner size={16} color={tokens.onSignal} />}
    {children}
  </button>
);

export const SecondaryButton: React.FC<{ children: React.ReactNode; onClick: () => void; disabled?: boolean }> = ({
  children,
  onClick,
  disabled,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`w-full border text-[14px] font-semibold transition-colors hover:enabled:bg-[var(--t-overlay-hover)] disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
    style={{ height: 46, borderRadius: radius.control, borderColor: tokens.hairline, background: tokens.card, color: tokens.paper }}
  >
    {children}
  </button>
);

export const TextButton: React.FC<{
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}> = ({ children, onClick, disabled, icon }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none disabled:opacity-50"
    style={{ color: tokens.signal, fontSize: typeScale.label.fontSize }}
  >
    {icon}
    {children}
  </button>
);
