import React, { useState } from 'react';
import { EyeIcon, EyeOffIcon, tokens } from '../../../design-system';
import { AuthField, AuthFieldProps } from './AuthField';
import { PasswordMeter } from './PasswordMeter';

type PasswordFieldProps = Omit<AuthFieldProps, 'type' | 'trailing'> & {
  /** Show the strength meter (sign-up only). */
  showMeter?: boolean;
};

export const PasswordField: React.FC<PasswordFieldProps> = ({ showMeter, ...props }) => {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOffIcon : EyeIcon;
  return (
    <div className="flex flex-col gap-2">
      <AuthField
        {...props}
        type={visible ? 'text' : 'password'}
        trailing={
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--t-overlay-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--t-focus-ring)]"
            style={{ color: tokens.mute }}
          >
            <Icon className="w-[18px] h-[18px]" />
          </button>
        }
      />
      {showMeter && props.value && <PasswordMeter password={props.value} />}
    </div>
  );
};
