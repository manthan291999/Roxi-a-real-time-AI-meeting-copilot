import type { FormMode } from '../flow/types';

/** Headings for each form, shown above its fields. */
export const FORM_HEADINGS: Record<FormMode, { eyebrow: string; title: string; body: string }> = {
  signIn: {
    eyebrow: 'Sign in',
    title: 'Welcome back',
    body: 'Sign in to pick up where your last meeting left off.',
  },
  signUp: {
    eyebrow: 'Create account',
    title: 'Create your account',
    body: 'Live explanations, action items, and replies for every meeting.',
  },
  sso: {
    eyebrow: 'Company SSO',
    title: 'Sign in with SSO',
    body: "Enter your work email and we'll send you to your company's sign-in page.",
  },
  forgot: {
    eyebrow: 'Account recovery',
    title: 'Reset your password',
    body: 'Enter the email you signed up with and we will send you a reset link.',
  },
};

/** The one-line reassurance under each form. */
export const FORM_FOOTNOTES: Record<FormMode, string> = {
  signIn: 'Signing in keeps your meetings in sync across your devices.',
  signUp: 'Your meetings are private to your workspace. You own your data and can delete it any time.',
  forgot: 'For your security we never say whether an address has an account.',
  sso: 'Your company must have SSO set up with Roxi. If it does not, use your email and password.',
};

/** Steps shown while a new account is being confirmed. */
export const SIGN_UP_STEPS = ['Account', 'Verify email', 'Start'] as const;
