import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useServices } from '../../context/useServices';
import { AccountState, SignUpResult } from '../../shared/types/account';

type Status = 'loading' | 'ready';

interface AccountContextValue {
  status: Status;
  account: AccountState;
  /** Owners and admins can import local history into the workspace. */
  canImport: boolean;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
}

const INITIAL: AccountState = { configured: false, user: null, workspace: null };

const AccountContext = createContext<AccountContextValue | null>(null);

/**
 * Owns the signed-in account for the whole app. Loaded once on launch
 * (restoring the Keychain session) and replaced after every auth action.
 */
export const AccountProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { accountService } = useServices();
  const [status, setStatus] = useState<Status>('loading');
  const [account, setAccount] = useState<AccountState>(INITIAL);

  const refresh = useCallback(async () => {
    setAccount(await accountService.getState());
    setStatus('ready');
  }, [accountService]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setAccount(await accountService.signIn(email, password));
    },
    [accountService],
  );

  const signUp = useCallback(
    async (email: string, password: string, fullName: string) => {
      const result = await accountService.signUp(email, password, fullName);
      if (result.status === 'signedIn') setAccount(result.account);
      return result;
    },
    [accountService],
  );

  const signOut = useCallback(async () => {
    await accountService.signOut();
    setAccount((current) => ({ ...current, user: null, workspace: null }));
  }, [accountService]);

  const value = useMemo<AccountContextValue>(
    () => ({
      status,
      account,
      canImport: account.workspace?.role === 'owner' || account.workspace?.role === 'admin',
      refresh,
      signIn,
      signUp,
      signOut,
      sendPasswordReset: (email) => accountService.sendPasswordReset(email),
      resendConfirmation: (email) => accountService.resendConfirmation(email),
    }),
    [status, account, refresh, signIn, signUp, signOut, accountService],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
};

export function useAccount(): AccountContextValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount must be used inside <AccountProvider>');
  return value;
}
