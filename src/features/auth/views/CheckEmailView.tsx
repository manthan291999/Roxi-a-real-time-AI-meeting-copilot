import React from 'react';
import { MailIcon, tokens } from '../../../design-system';
import { AuthHeader, IconTile, PrimaryButton, SecondaryButton, StepIndicator, TextButton } from '../components';
import { SIGN_UP_STEPS } from '../content/copy';
import type { AuthFlow } from '../flow/types';
import { FormFeedback } from './FormFeedback';
import { FormFootnote } from './FormFootnote';
import { FeedbackProps } from './viewProps';

type CheckEmailViewProps = FeedbackProps & Pick<AuthFlow, 'values'>;

/** After sign-up, while the account waits for its email to be confirmed. */
export const CheckEmailView: React.FC<CheckEmailViewProps> = ({ values, ...feedback }) => {
  const { busy, cooldown, switchMode, resendConfirmation } = feedback;
  return (
    <div className="flex flex-col gap-6">
      <StepIndicator steps={SIGN_UP_STEPS} current={1} />

      <IconTile icon={MailIcon} />

      <AuthHeader title="Check your inbox">
        We sent a confirmation link to <strong style={{ color: tokens.paper }}>{values.email.trim()}</strong>. Open it, then
        come back here and sign in.
      </AuthHeader>

      <FormFeedback {...feedback} />

      <div className="flex flex-col gap-2.5">
        <PrimaryButton type="button" onClick={() => switchMode('signIn')}>
          I confirmed it, sign in
        </PrimaryButton>
        <SecondaryButton onClick={resendConfirmation} disabled={busy || cooldown > 0}>
          {cooldown > 0 ? `Resend email in ${cooldown}s` : 'Resend email'}
        </SecondaryButton>
      </div>

      <div className="flex flex-col gap-1.5 items-start">
        <FormFootnote align="left">No email after a few minutes? Check your spam folder, or make sure the address is right.</FormFootnote>
        <TextButton onClick={() => switchMode('signUp')}>Use a different email</TextButton>
      </div>
    </div>
  );
};
