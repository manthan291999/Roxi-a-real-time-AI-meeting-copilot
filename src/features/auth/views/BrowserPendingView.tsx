import React from 'react';
import { LaptopIcon, tokens, typeScale } from '../../../design-system';
import { Spinner } from '../../../shared/ui/Spinner';
import { AuthHeader, IconTile, SecondaryButton } from '../components';
import { PROVIDER_CATALOG } from '../federated';
import type { AuthFlow, BrowserSignIn } from '../flow/types';
import { FormFootnote } from './FormFootnote';

type BrowserPendingViewProps = Pick<AuthFlow, 'browserSignIn' | 'cancelBrowserSignIn'>;

const destination = (signIn: BrowserSignIn | null): string =>
  signIn?.kind === 'provider' ? `the ${PROVIDER_CATALOG[signIn.provider].label} sign-in page` : "your company's sign-in page";

/** Shown while the user finishes signing in in their browser. */
export const BrowserPendingView: React.FC<BrowserPendingViewProps> = ({ browserSignIn, cancelBrowserSignIn }) => (
  <div className="flex flex-col gap-6">
    <IconTile icon={LaptopIcon} />

    <AuthHeader eyebrow="Almost there" title="Continue in your browser">
      We opened {destination(browserSignIn)} in your browser. Finish there and Roxi opens automatically.
    </AuthHeader>

    <div className="flex items-center gap-3" role="status" style={{ color: tokens.mute, fontSize: typeScale.label.fontSize }}>
      <Spinner size={16} />
      Waiting for your browser…
    </div>

    <SecondaryButton onClick={cancelBrowserSignIn}>Cancel</SecondaryButton>

    <FormFootnote align="left">
      Don't see it? Check your other browser windows. Your password is entered on that page, never in Roxi.
    </FormFootnote>
  </div>
);
