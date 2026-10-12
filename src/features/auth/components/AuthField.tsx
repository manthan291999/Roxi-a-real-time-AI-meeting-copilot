import React, { useId } from 'react';
import { radius, tokens, typeScale } from '../../../design-system';

const inputClass =
  'w-full border px-3.5 text-[14px] leading-tight outline-none transition-colors placeholder:text-[var(--t-mute-dim)] focus:border-[var(--t-signal)] focus:shadow-[0_0_0_3px_var(--t-signal-focus)] disabled:cursor-not-allowed disabled:opacity-60';

export interface AuthFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Sits inside the input, on the right (e.g. show/hide password). */
  trailing?: React.ReactNode;
  /** Sits on the label row, on the right (e.g. "Forgot password?"). */
  labelAction?: React.ReactNode;
}

export const AuthField: React.FC<AuthFieldProps> = ({
  label,
  value,
  onChange,
  error,
  type = 'text',
  autoComplete,
  placeholder,
  autoFocus,
  disabled,
  trailing,
  labelAction,
}) => {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} style={{ color: tokens.paper, fontSize: typeScale.label.fontSize, fontWeight: typeScale.label.fontWeight }}>
          {label}
        </label>
        {labelAction}
      </div>
      <div className="relative">
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={inputClass}
          style={{
            height: 44,
            borderRadius: radius.control,
            backgroundColor: tokens.card,
            borderColor: error ? tokens.danger : tokens.hairline,
            color: tokens.paper,
            paddingRight: trailing ? 48 : undefined,
          }}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {error && (
        <p id={errorId} role="alert" style={{ color: tokens.danger, fontSize: typeScale.caption.fontSize }}>
          {error}
        </p>
      )}
    </div>
  );
};
