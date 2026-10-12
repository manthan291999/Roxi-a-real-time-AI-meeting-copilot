import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { IAccountService } from '../shared/interfaces/IAccountService';
import {
  AccountState,
  AuthError,
  ImportProgress,
  LocalHistoryStats,
  SignUpResult,
} from '../shared/types/account';

/** Rust rejects with `{ code, message }`; anything else becomes 'unknown'. */
export function toAuthError(error: unknown): AuthError {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    return error as AuthError;
  }
  const message = typeof error === 'string' && error.trim() ? error : 'Something went wrong. Try again.';
  return { code: 'unknown', message };
}

const LOCAL_MODE: AccountState = { configured: false, user: null, workspace: null };

/**
 * Tauri adapter for IAccountService.
 * The ONLY file that knows the Rust command names for accounts.
 */
export class TauriAccountService implements IAccountService {
  async getState(): Promise<AccountState> {
    try {
      return await invoke<AccountState>('auth_get_state');
    } catch {
      // A build without the account commands behaves as local-only.
      return LOCAL_MODE;
    }
  }

  private async call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      throw toAuthError(error);
    }
  }

  signIn(email: string, password: string) {
    return this.call<AccountState>('auth_sign_in', { email, password });
  }

  signUp(email: string, password: string, fullName?: string) {
    return this.call<SignUpResult>('auth_sign_up', { email, password, fullName: fullName ?? null });
  }

  signOut() {
    return this.call<void>('auth_sign_out');
  }

  sendPasswordReset(email: string) {
    return this.call<void>('auth_send_password_reset', { email });
  }

  resendConfirmation(email: string) {
    return this.call<void>('auth_resend_confirmation', { email });
  }

  getLocalHistoryStats() {
    return invoke<LocalHistoryStats>('get_local_history_stats');
  }

  async importLocalHistory(onProgress: (progress: ImportProgress) => void): Promise<ImportProgress> {
    // Subscribe before starting so the first batch's event is not missed.
    const unlisten = await listen<ImportProgress>('import_progress', (event) => onProgress(event.payload));
    try {
      return await invoke<ImportProgress>('import_local_history');
    } finally {
      unlisten();
    }
  }
}
