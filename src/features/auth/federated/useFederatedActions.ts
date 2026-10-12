import { useEffect, useMemo, useState } from 'react';
import { useServices } from '../../../context/useServices';
import { SignInMethods } from '../../../shared/types/account';
import { useAccount } from '../AccountContext';
import type { FederatedActions } from '../flow/types';

const NO_METHODS: SignInMethods = { providers: [], companySso: false };

/**
 * Browser sign-in, bound to the real service and account. Returns which
 * options to show and the actions the flow calls; after a success it reloads
 * the account so AuthGate opens the app.
 */
export function useFederatedActions(): { methods: SignInMethods; actions: FederatedActions } {
  const { federatedSignInService: service } = useServices();
  const { refresh } = useAccount();
  const [methods, setMethods] = useState<SignInMethods>(NO_METHODS);

  useEffect(() => {
    let live = true;
    void service.getSignInMethods().then((m) => live && setMethods(m));
    return () => {
      live = false;
    };
  }, [service]);

  const actions = useMemo<FederatedActions>(
    () => ({
      signInWithProvider: async (provider) => {
        await service.signInWithProvider(provider);
        await refresh();
      },
      signInWithSso: async (email) => {
        await service.signInWithSso(email);
        await refresh();
      },
      cancelBrowserSignIn: () => service.cancel(),
    }),
    [service, refresh],
  );

  return { methods, actions };
}
