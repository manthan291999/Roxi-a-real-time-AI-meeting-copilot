import type React from 'react';
import { AuthError, OAuthProviderId, SignUpResult } from '../../../shared/types/account';

/** Every screen the sign-in flow can show. */
export type AuthMode = 'signIn' | 'signUp' | 'forgot' | 'sso' | 'checkEmail';

/** The modes that submit a form. `checkEmail` only offers buttons. */
export type FormMode = Exclude<AuthMode, 'checkEmail'>;

export type AuthFieldName = 'name' | 'email' | 'password';

export type AuthFormValues = Record<AuthFieldName, string>;

export type FieldErrors = Partial<Record<AuthFieldName, string>>;

/** Email and password operations. Satisfied by `useAccount()`. */
export interface PasswordActions {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<SignUpResult>;
  sendPasswordReset: (email: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
}

/** Browser sign-in operations. Satisfied by `useFederatedActions()`. */
export interface FederatedActions {
  signInWithProvider: (provider: OAuthProviderId) => Promise<void>;
  signInWithSso: (email: string) => Promise<void>;
  cancelBrowserSignIn: () => Promise<void>;
}

/**
 * Everything the flow may ask of the account. Ports rather than hooks, so
 * the flow runs against any implementation (the real account, or a fake).
 */
export type AuthActions = PasswordActions & FederatedActions;

/** A sign-in waiting on the browser, and what it is for. */
export type BrowserSignIn = { kind: 'provider'; provider: OAuthProviderId } | { kind: 'sso'; email: string };

/** Everything a view can read from, or ask of, the flow. */
export interface AuthFlow {
  mode: AuthMode;
  values: AuthFormValues;
  fieldErrors: FieldErrors;
  error: AuthError | null;
  notice: string | null;
  busy: boolean;
  /** Seconds before another email can be sent; 0 when it can. */
  cooldown: number;
  /** Set while the user finishes signing in in their browser. */
  browserSignIn: BrowserSignIn | null;
  setField: (field: AuthFieldName, value: string) => void;
  switchMode: (next: AuthMode) => void;
  submit: (event: React.FormEvent) => void;
  resendConfirmation: () => void;
  startProvider: (provider: OAuthProviderId) => void;
  cancelBrowserSignIn: () => void;
}
