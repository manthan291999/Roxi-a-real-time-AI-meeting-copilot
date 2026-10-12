import React from 'react';
import { AuthField, AuthHeader, ModeTabs, PasswordField, PrimaryButton, TextButton } from '../components';
import { FORM_FOOTNOTES, FORM_HEADINGS } from '../content/copy';
import { FederatedOptions } from '../federated';
import { FormFeedback } from './FormFeedback';
import { FormFootnote } from './FormFootnote';
import { EntryViewProps } from './viewProps';

const heading = FORM_HEADINGS.signIn;

export const SignInView: React.FC<EntryViewProps> = ({ values, setField, fieldErrors, submit, methods, startProvider, ...feedback }) => (
  <div className="flex flex-col gap-6">
    <AuthHeader eyebrow={heading.eyebrow} title={heading.title}>
      {heading.body}
    </AuthHeader>

    <ModeTabs mode="signIn" onChange={feedback.switchMode} disabled={feedback.busy} />

    <FormFeedback {...feedback} />

    <FederatedOptions
      methods={methods}
      onProvider={startProvider}
      onCompanySso={() => feedback.switchMode('sso')}
      disabled={feedback.busy}
    />

    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <AuthField
        label="Work email"
        type="email"
        value={values.email}
        onChange={(v) => setField('email', v)}
        error={fieldErrors.email}
        autoComplete="email"
        placeholder="name@company.com"
        autoFocus
        disabled={feedback.busy}
      />
      <PasswordField
        label="Password"
        value={values.password}
        onChange={(v) => setField('password', v)}
        error={fieldErrors.password}
        autoComplete="current-password"
        placeholder="Your password"
        disabled={feedback.busy}
        labelAction={<TextButton onClick={() => feedback.switchMode('forgot')}>Forgot password?</TextButton>}
      />
      <div className="pt-1">
        <PrimaryButton loading={feedback.busy}>Sign in</PrimaryButton>
      </div>
    </form>

    <FormFootnote>{FORM_FOOTNOTES.signIn}</FormFootnote>
  </div>
);
