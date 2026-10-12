/** Mirrors `src-tauri/src/domain/account.rs`. Tokens never reach the webview. */

export interface AccountUser {
  id: string;
  email: string | null;
  fullName: string | null;
}

export interface Workspace {
  orgId: string;
  orgName: string;
  /** 'owner' | 'admin' | 'member' */
  role: string;
  /** 'free' | 'pro' | 'team' | 'enterprise' */
  plan: string;
}

/** `configured: false` means local-only mode: no sign-in, app works as before. */
export interface AccountState {
  configured: boolean;
  user: AccountUser | null;
  workspace: Workspace | null;
}

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'user_exists'
  | 'weak_password'
  | 'invalid_input'
  | 'rate_limited'
  | 'network'
  | 'not_configured'
  | 'session_expired'
  /** The user closed or abandoned a browser sign-in. Never shown as an error. */
  | 'cancelled'
  | 'unknown';

export interface AuthError {
  code: AuthErrorCode;
  message: string;
}

export type SignUpResult =
  | { status: 'signedIn'; account: AccountState }
  | { status: 'confirmEmail' };

/** Browser sign-in providers. Mirrors `OAuthProvider` in `src-tauri/src/domain/federated.rs`. */
export type OAuthProviderId = 'azure' | 'google';

/** Which browser sign-in options this build offers. Mirrors `SignInMethods`. */
export interface SignInMethods {
  providers: OAuthProviderId[];
  companySso: boolean;
}

export interface LocalHistoryStats {
  meetings: number;
  transcriptLines: number;
  projects: number;
}

export interface ImportProgress {
  total: number;
  processed: number;
  imported: number;
  skipped: number;
}
