import React from 'react';
import { useAccount } from './AccountContext';
import { useFederatedActions } from './federated';
import { useAuthFlow } from './flow';
import { AuthLayout } from './layout/AuthLayout';
import { AUTH_VIEWS, BrowserPendingView } from './views';

/**
 * Sign in (by password or through the browser), create an account, reset a
 * password, and confirm an email.
 *
 * This component only composes: the account and the federated service supply
 * the actions, the flow owns state and behaviour, the layout owns the frame,
 * and the view registry picks what to show.
 */
export const AuthScreen: React.FC = () => {
  const account = useAccount();
  const federated = useFederatedActions();
  const flow = useAuthFlow({ ...account, ...federated.actions });
  const View = flow.browserSignIn ? BrowserPendingView : AUTH_VIEWS[flow.mode];
  return (
    <AuthLayout>
      <View {...flow} methods={federated.methods} />
    </AuthLayout>
  );
};
