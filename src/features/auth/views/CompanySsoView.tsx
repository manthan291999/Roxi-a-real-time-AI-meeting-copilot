import React from 'react';
import { ChevronLeftIcon, ShieldCheckIcon } from '../../../design-system';
import { AuthField, AuthHeader, IconTile, PrimaryButton, TextButton } from '../components';
import { FORM_FOOTNOTES, FORM_HEADINGS } from '../content/copy';
import { FormFeedback } from './FormFeedback';
import { FormFootnote } from './FormFootnote';
import { FormViewProps } from './viewProps';

const heading = FORM_HEADINGS.sso;

/** Company SSO: the work email's domain picks the company's sign-in page. */
export const CompanySsoView: React.FC<FormViewProps> = ({ values, setField, fieldErrors, submit, ...feedback }) => (
  <div className="flex flex-col gap-6">
    <div>
      <TextButton onClick={() => feedback.switchMode('signIn')} icon={<ChevronLeftIcon className="w-4 h-4" />}>
        Back to sign in
      </TextButton>
    </div>

    <IconTile icon={ShieldCheckIcon} />

    <AuthHeader eyebrow={heading.eyebrow} title={heading.title}>
      {heading.body}
    </AuthHeader>

    <FormFeedback {...feedback} />

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
      <div className="pt-1">
        <PrimaryButton loading={feedback.busy}>Continue with SSO</PrimaryButton>
      </div>
    </form>

    <FormFootnote align="left">{FORM_FOOTNOTES.sso}</FormFootnote>
  </div>
);
