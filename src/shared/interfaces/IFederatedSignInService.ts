import { AccountState, OAuthProviderId, SignInMethods } from '../types/account';

/**
 * Port: sign-in through the browser (Microsoft, Google, company SSO).
 *
 * Separate from IAccountService so password-only code and its fakes never
 * depend on it. Implementors: TauriFederatedSignInService, fakes in tests.
 * Sign-in methods reject with an `AuthError`; `code: 'cancelled'` means the
 * user gave up and nothing should be shown.
 */
export interface IFederatedSignInService {
  /** Never rejects. Empty when no browser sign-in is set up. */
  getSignInMethods(): Promise<SignInMethods>;
  /** Opens the provider in the browser; resolves once the user is signed in. */
  signInWithProvider(provider: OAuthProviderId): Promise<AccountState>;
  /** Company SSO, found by the domain of `email`. */
  signInWithSso(email: string): Promise<AccountState>;
  /** Stops a sign-in that is waiting on the browser. */
  cancel(): Promise<void>;
}
