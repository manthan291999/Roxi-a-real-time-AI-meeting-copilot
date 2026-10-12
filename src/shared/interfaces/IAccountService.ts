import { AccountState, ImportProgress, LocalHistoryStats, SignUpResult } from '../types/account';

/**
 * Port: sign-in and account data.
 *
 * Implementors: TauriAccountService (production), fakes in tests.
 * Auth methods reject with an `AuthError` ({ code, message }).
 */
export interface IAccountService {
  /** Never rejects. Restores a saved session and refreshes it if needed. */
  getState(): Promise<AccountState>;
  signIn(email: string, password: string): Promise<AccountState>;
  signUp(email: string, password: string, fullName?: string): Promise<SignUpResult>;
  signOut(): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  resendConfirmation(email: string): Promise<void>;

  /** What is saved on this Mac and could be imported. */
  getLocalHistoryStats(): Promise<LocalHistoryStats>;
  /** Uploads local history to the signed-in workspace. Safe to repeat. */
  importLocalHistory(onProgress: (progress: ImportProgress) => void): Promise<ImportProgress>;
}
