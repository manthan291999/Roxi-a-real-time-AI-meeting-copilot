import { invoke } from '@tauri-apps/api/core';
import { IFederatedSignInService } from '../shared/interfaces/IFederatedSignInService';
import { AccountState, OAuthProviderId, SignInMethods } from '../shared/types/account';
import { toAuthError } from './TauriAccountService';

const NONE: SignInMethods = { providers: [], companySso: false };

/**
 * Tauri adapter for IFederatedSignInService.
 * The ONLY file that knows the Rust command names for browser sign-in.
 */
export class TauriFederatedSignInService implements IFederatedSignInService {
  async getSignInMethods(): Promise<SignInMethods> {
    try {
      return await invoke<SignInMethods>('auth_sign_in_methods');
    } catch {
      // A build without the command offers email and password only.
      return NONE;
    }
  }

  signInWithProvider(provider: OAuthProviderId) {
    return this.call<AccountState>('auth_sign_in_oauth', { provider });
  }

  signInWithSso(email: string) {
    return this.call<AccountState>('auth_sign_in_sso', { email });
  }

  cancel() {
    return this.call<void>('auth_cancel_federated');
  }

  private async call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      throw toAuthError(error);
    }
  }
}
