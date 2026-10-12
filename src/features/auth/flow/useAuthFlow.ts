import React, { useCallback, useState } from 'react';
import { AuthError, OAuthProviderId } from '../../../shared/types/account';
import { SUBMIT_HANDLERS } from './submitHandlers';
import { AuthActions, AuthFieldName, AuthFlow, AuthFormValues, AuthMode, BrowserSignIn, FieldErrors } from './types';
import { useCooldown } from './useCooldown';
import { validateForm } from './validateForm';

/** Seconds before "Resend" works again; Supabase rate-limits email sends. */
export const RESEND_COOLDOWN = 30;

const EMPTY_VALUES: AuthFormValues = { name: '', email: '', password: '' };

/**
 * The sign-in flow's state and behaviour, with no markup. Views render what
 * it returns; AuthScreen wires it to the real account.
 *
 * Switching modes keeps the email (and name) the user already typed, and
 * clears the password.
 */
export function useAuthFlow(actions: AuthActions): AuthFlow {
  const [mode, setMode] = useState<AuthMode>('signIn');
  const [values, setValues] = useState<AuthFormValues>(EMPTY_VALUES);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<AuthError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [browserSignIn, setBrowserSignIn] = useState<BrowserSignIn | null>(null);
  const cooldown = useCooldown(RESEND_COOLDOWN);

  const setField = useCallback((field: AuthFieldName, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  }, []);

  const switchMode = useCallback((next: AuthMode) => {
    setMode(next);
    setFieldErrors({});
    setError(null);
    setNotice(null);
    setValues((current) => ({ ...current, password: '' }));
  }, []);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      const authError = e as AuthError;
      // Closing the browser tab is a choice, not a failure.
      if (authError.code !== 'cancelled') setError(authError);
    } finally {
      setBusy(false);
      setBrowserSignIn(null);
    }
  }, []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (mode === 'checkEmail') return;
    const errors = validateForm(mode, values);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    void run(() =>
      SUBMIT_HANDLERS[mode](values, {
        actions,
        goTo: setMode,
        notify: setNotice,
        startCooldown: cooldown.start,
        awaitBrowser: setBrowserSignIn,
      }),
    );
  };

  const resendConfirmation = () =>
    void run(async () => {
      await actions.resendConfirmation(values.email.trim());
      setNotice('We sent another confirmation email.');
      cooldown.start();
    });

  const startProvider = (provider: OAuthProviderId) =>
    void run(() => {
      setBrowserSignIn({ kind: 'provider', provider });
      return actions.signInWithProvider(provider);
    });

  const cancelBrowserSignIn = () => void actions.cancelBrowserSignIn().catch(() => {});

  return {
    mode,
    values,
    fieldErrors,
    error,
    notice,
    busy,
    cooldown: cooldown.remaining,
    browserSignIn,
    setField,
    switchMode,
    submit,
    resendConfirmation,
    startProvider,
    cancelBrowserSignIn,
  };
}
