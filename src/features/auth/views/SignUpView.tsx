import React from 'react';
import { AuthField, AuthHeader, ModeTabs, PasswordField, PrimaryButton } from '../components';
import { FORM_FOOTNOTES, FORM_HEADINGS } from '../content/copy';
import { FederatedOptions } from '../federated';
import { FormFeedback } from './FormFeedback';
import { FormFootnote } from './FormFootnote';
import { EntryViewProps } from './viewProps';

const heading = FORM_HEADINGS.signUp;

export const SignUpView: React.FC<EntryViewProps> = ({ values, setField, fieldErrors, submit, methods, startProvider, ...feedback }) => (
  <div className="flex flex-col gap-6">
    <AuthHeader eyebrow={heading.eyebrow} title={heading.title}>
      {heading.body}
    </AuthHeader>

    <ModeTabs mode="signUp" onChange={feedback.switchMode} disabled={feedback.busy} />

    <FormFeedback {...feedback} />

    <FederatedOptions
      methods={methods}
      onProvider={startProvider}
      onCompanySso={() => feedback.switchMode('sso')}
      disabled={feedback.busy}
    />

    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <AuthField
        label="Your name"
        value={values.name}
        onChange={(v) => setField('name', v)}
        error={fieldErrors.name}
        autoComplete="name"
        placeholder="Ana Ruiz"
        autoFocus
        disabled={feedback.busy}
      />
      <AuthField
        label="Work email"
        type="email"
        value={values.email}
        onChange={(v) => setField('email', v)}
        error={fieldErrors.email}
        autoComplete="email"
        placeholder="name@company.com"
        disabled={feedback.busy}
      />
      <PasswordField
        label="Password"
        value={values.password}
        onChange={(v) => setField('password', v)}
        error={fieldErrors.password}
        autoComplete="new-password"
        placeholder="At least 8 characters"
        showMeter
        disabled={feedback.busy}
      />
      <div className="pt-1">
        <PrimaryButton loading={feedback.busy}>Create account</PrimaryButton>
      </div>
    </form>

    <FormFootnote>{FORM_FOOTNOTES.signUp}</FormFootnote>
  </div>
);
