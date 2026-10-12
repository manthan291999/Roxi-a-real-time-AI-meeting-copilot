import React from 'react';
import { AuthErrorCode } from '../../../shared/types/account';
import { TextButton } from '../components';
import { FeedbackProps } from './viewProps';

type RecoveryContext = Omit<FeedbackProps, 'error' | 'notice'>;

/**
 * The one-tap way out of each recoverable error. An error code without an
 * entry shows its message alone; supporting a new code is one entry here.
 */
const RECOVERY_ACTIONS: Partial<Record<AuthErrorCode, (ctx: RecoveryContext) => React.ReactNode>> = {
  user_exists: ({ switchMode }) => <TextButton onClick={() => switchMode('signIn')}>Sign in instead</TextButton>,
  email_not_confirmed: ({ resendConfirmation, busy, cooldown }) => (
    <TextButton onClick={resendConfirmation} disabled={busy || cooldown > 0}>
      {cooldown > 0 ? `Resend confirmation email (${cooldown}s)` : 'Resend confirmation email'}
    </TextButton>
  ),
  invalid_credentials: ({ switchMode }) => <TextButton onClick={() => switchMode('forgot')}>Reset your password</TextButton>,
};

export function recoveryActionFor(code: AuthErrorCode, ctx: RecoveryContext): React.ReactNode {
  return RECOVERY_ACTIONS[code]?.(ctx);
}
