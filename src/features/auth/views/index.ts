import type React from 'react';
import type { AuthMode } from '../flow/types';
import { CheckEmailView } from './CheckEmailView';
import { CompanySsoView } from './CompanySsoView';
import { ForgotPasswordView } from './ForgotPasswordView';
import { SignInView } from './SignInView';
import { SignUpView } from './SignUpView';
import type { AuthViewProps } from './viewProps';

export { BrowserPendingView } from './BrowserPendingView';
export type { AuthViewProps } from './viewProps';

/**
 * Which view renders each mode. Every view accepts the view props (or a
 * narrower slice of them), so a new screen is a new view plus one entry here.
 */
export const AUTH_VIEWS: Record<AuthMode, React.ComponentType<AuthViewProps>> = {
  signIn: SignInView,
  signUp: SignUpView,
  forgot: ForgotPasswordView,
  sso: CompanySsoView,
  checkEmail: CheckEmailView,
};
