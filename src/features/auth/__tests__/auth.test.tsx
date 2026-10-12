// Brings jest-dom's matcher types into tsc; vitest.setup.ts registers them at runtime but sits outside tsconfig's src include.
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '../../../context/ServicesProvider';
import { IServices } from '../../../context/ServicesContext';
import { IAccountService } from '../../../shared/interfaces/IAccountService';
import { IFederatedSignInService } from '../../../shared/interfaces/IFederatedSignInService';
import { AccountState, AuthError } from '../../../shared/types/account';
import { AccountProvider } from '../AccountContext';
import { AuthGate } from '../AuthGate';
import { ImportHistoryPrompt } from '../ImportHistoryPrompt';
import { passwordStrength, validateEmail, validateNewPassword } from '../validation';

const SIGNED_OUT: AccountState = { configured: true, user: null, workspace: null };
const SIGNED_IN: AccountState = {
  configured: true,
  user: { id: 'u1', email: 'ana@example.com', fullName: 'Ana' },
  workspace: { orgId: 'o1', orgName: "ana's workspace", role: 'owner', plan: 'free' },
};

function fakeAccount(overrides: Partial<IAccountService> = {}): IAccountService {
  return {
    getState: vi.fn().mockResolvedValue(SIGNED_OUT),
    signIn: vi.fn().mockResolvedValue(SIGNED_IN),
    signUp: vi.fn().mockResolvedValue({ status: 'confirmEmail' }),
    signOut: vi.fn().mockResolvedValue(undefined),
    sendPasswordReset: vi.fn().mockResolvedValue(undefined),
    resendConfirmation: vi.fn().mockResolvedValue(undefined),
    getLocalHistoryStats: vi.fn().mockResolvedValue({ meetings: 0, transcriptLines: 0, projects: 0 }),
    importLocalHistory: vi.fn(),
    ...overrides,
  };
}

function fakeFederated(overrides: Partial<IFederatedSignInService> = {}): IFederatedSignInService {
  return {
    getSignInMethods: vi.fn().mockResolvedValue({ providers: [], companySso: false }),
    signInWithProvider: vi.fn().mockResolvedValue(SIGNED_IN),
    signInWithSso: vi.fn().mockResolvedValue(SIGNED_IN),
    cancel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderWithAccount(
  ui: React.ReactElement,
  accountService: IAccountService,
  federatedSignInService: IFederatedSignInService = fakeFederated(),
) {
  return render(
    <ServicesProvider services={{ accountService, federatedSignInService } as Partial<IServices>}>
      <AccountProvider>{ui}</AccountProvider>
    </ServicesProvider>,
  );
}

const gated = <AuthGate><div>Roxi app</div></AuthGate>;

describe('validation', () => {
  it('checks emails and new passwords', () => {
    expect(validateEmail('')).toMatch(/Enter your email/);
    expect(validateEmail('ana@')).toMatch(/valid email/);
    expect(validateEmail(' ana@example.com ')).toBeNull();
    expect(validateNewPassword('short')).toMatch(/at least 8/);
    expect(validateNewPassword('long-enough')).toBeNull();
  });

  it('rates password strength', () => {
    expect(passwordStrength('abc').label).toBe('Too short');
    expect(passwordStrength('abcdefgh').label).toBe('Weak');
    expect(passwordStrength('Abcdefgh1!xyz').label).toBe('Strong');
  });
});

describe('AuthGate', () => {
  it('opens the app directly in local-only mode', async () => {
    renderWithAccount(gated, fakeAccount({ getState: vi.fn().mockResolvedValue({ configured: false, user: null, workspace: null }) }));
    expect(await screen.findByText('Roxi app')).toBeInTheDocument();
  });

  it('opens the app for a restored session', async () => {
    renderWithAccount(gated, fakeAccount({ getState: vi.fn().mockResolvedValue(SIGNED_IN) }));
    expect(await screen.findByText('Roxi app')).toBeInTheDocument();
  });

  it('shows sign-in when signed out, and the app after signing in', async () => {
    const service = fakeAccount();
    renderWithAccount(gated, service);
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.queryByText('Roxi app')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'ana@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'right-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Roxi app')).toBeInTheDocument();
    expect(service.signIn).toHaveBeenCalledWith('ana@example.com', 'right-password');
  });
});

describe('AuthScreen', () => {
  let service: IAccountService;
  beforeEach(() => {
    service = fakeAccount();
  });

  it('validates before calling the service', async () => {
    renderWithAccount(gated, service);
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(service.signIn).not.toHaveBeenCalled();
  });

  it('shows the server message and a recovery action for wrong credentials', async () => {
    const error: AuthError = { code: 'invalid_credentials', message: "That email and password don't match." };
    service = fakeAccount({ signIn: vi.fn().mockRejectedValue(error) });
    renderWithAccount(gated, service);
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'ana@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText(error.message)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset your password' }));
    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
    expect(screen.getByLabelText('Work email')).toHaveValue('ana@example.com');
  });

  it('creates an account and asks the user to confirm their email', async () => {
    renderWithAccount(gated, service);
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getByRole('tab', { name: 'Create account' }));

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ana Ruiz' } });
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'ana@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(service.signUp).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Long-enough-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    expect(service.signUp).toHaveBeenCalledWith('ana@example.com', 'Long-enough-1', 'Ana Ruiz');
    expect(screen.getByRole('button', { name: /Resend email in/ })).toBeDisabled();
  });

  it('sends a password reset link', async () => {
    renderWithAccount(gated, service);
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'ana@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/a reset link is on its way/)).toBeInTheDocument();
    expect(service.sendPasswordReset).toHaveBeenCalledWith('ana@example.com');
  });

  it('toggles password visibility', async () => {
    renderWithAccount(gated, service);
    await screen.findByRole('heading', { name: 'Welcome back' });
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
  });
});

describe('Browser sign-in', () => {
  const methods = { providers: ['azure'] as const, companySso: true };

  it('hides the buttons when no browser sign-in is set up', async () => {
    renderWithAccount(gated, fakeAccount());
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(screen.queryByRole('button', { name: 'Continue with Microsoft' })).toBeNull();
    expect(screen.queryByText('or with email')).toBeNull();
  });

  it('waits on the browser, then opens the app', async () => {
    let finish: (state: AccountState) => void = () => {};
    const federated = fakeFederated({
      getSignInMethods: vi.fn().mockResolvedValue({ ...methods, providers: [...methods.providers] }),
      signInWithProvider: vi.fn(() => new Promise<AccountState>((resolve) => (finish = resolve))),
    });
    const account = fakeAccount();
    renderWithAccount(gated, account, federated);

    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Microsoft' }));
    expect(await screen.findByRole('heading', { name: 'Continue in your browser' })).toBeInTheDocument();
    expect(screen.getByText(/the Microsoft sign-in page/)).toBeInTheDocument();
    expect(federated.signInWithProvider).toHaveBeenCalledWith('azure');

    (account.getState as ReturnType<typeof vi.fn>).mockResolvedValue(SIGNED_IN);
    await act(async () => finish(SIGNED_IN));
    expect(await screen.findByText('Roxi app')).toBeInTheDocument();
  });

  it('returns quietly to sign in when the user cancels', async () => {
    const cancelled: AuthError = { code: 'cancelled', message: 'Sign-in was cancelled.' };
    let fail: (e: AuthError) => void = () => {};
    const federated = fakeFederated({
      getSignInMethods: vi.fn().mockResolvedValue({ ...methods, providers: [...methods.providers] }),
      signInWithProvider: vi.fn(() => new Promise<AccountState>((_, reject) => (fail = reject))),
      cancel: vi.fn(async () => fail(cancelled)),
    });
    renderWithAccount(gated, fakeAccount(), federated);

    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Microsoft' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(federated.cancel).toHaveBeenCalled();
    expect(screen.queryByText(cancelled.message)).toBeNull();
  });

  it('signs in with company SSO from the work email', async () => {
    const federated = fakeFederated({
      getSignInMethods: vi.fn().mockResolvedValue({ ...methods, providers: [...methods.providers] }),
      signInWithSso: vi.fn().mockRejectedValue({ code: 'invalid_input', message: 'No company sign-in is set up for that email domain.' }),
    });
    renderWithAccount(gated, fakeAccount(), federated);

    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with company SSO' }));
    expect(screen.getByRole('heading', { name: 'Sign in with SSO' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with SSO' }));
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(federated.signInWithSso).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: ' ana@acme.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue with SSO' }));
    expect(await screen.findByText('No company sign-in is set up for that email domain.')).toBeInTheDocument();
    expect(federated.signInWithSso).toHaveBeenCalledWith('ana@acme.com');
  });
});

describe('ImportHistoryPrompt', () => {
  beforeEach(() => window.localStorage.clear());

  it('offers local meetings to an owner and imports them', async () => {
    const service = fakeAccount({
      getState: vi.fn().mockResolvedValue(SIGNED_IN),
      getLocalHistoryStats: vi.fn().mockResolvedValue({ meetings: 153, transcriptLines: 4156, projects: 1 }),
      importLocalHistory: vi.fn(async (onProgress) => {
        onProgress({ total: 153, processed: 10, imported: 10, skipped: 0 });
        return { total: 153, processed: 153, imported: 150, skipped: 3 };
      }),
    });
    renderWithAccount(<ImportHistoryPrompt />, service);

    const button = await screen.findByRole('button', { name: 'Import 153 meetings' });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(await screen.findByText('Imported 150 meetings. 3 were already in your workspace.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.localStorage.getItem('roxi.importPrompt.u1')).toBe('imported');
  });

  it('stays hidden for members and when there is nothing to import', async () => {
    const member = { ...SIGNED_IN, workspace: { ...SIGNED_IN.workspace!, role: 'member' } };
    const { unmount } = renderWithAccount(
      <ImportHistoryPrompt />,
      fakeAccount({
        getState: vi.fn().mockResolvedValue(member),
        getLocalHistoryStats: vi.fn().mockResolvedValue({ meetings: 5, transcriptLines: 10, projects: 1 }),
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    unmount();

    renderWithAccount(<ImportHistoryPrompt />, fakeAccount({ getState: vi.fn().mockResolvedValue(SIGNED_IN) }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
