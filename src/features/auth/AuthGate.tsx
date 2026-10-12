import React from 'react';
import { AppShell } from '../../shell/AppShell';
import { Spinner } from '../../shared/ui/Spinner';
import { useAccount } from './AccountContext';
import { AuthScreen } from './AuthScreen';

/**
 * Shows the sign-in screen until there is a user, then the app.
 *
 * In local-only mode (no Supabase settings in this build) the app opens
 * straight away, exactly as it did before accounts existed.
 */
export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { status, account } = useAccount();

  if (status === 'loading') {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center" aria-label="Loading your account">
          <Spinner size={22} />
        </div>
      </AppShell>
    );
  }

  if (account.configured && !account.user) {
    return (
      <AppShell>
        <AuthScreen />
      </AppShell>
    );
  }

  return <>{children}</>;
};
