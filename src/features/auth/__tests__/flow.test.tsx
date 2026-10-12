// Brings jest-dom's matcher types into tsc; vitest.setup.ts registers them at runtime but sits outside tsconfig's src include.
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StepIndicator } from '../components';
import { TRUST_POINTS } from '../content/brandContent';
import { SUBMIT_HANDLERS, SubmitContext } from '../flow/submitHandlers';
import { AuthActions } from '../flow/types';
import { validateForm } from '../flow/validateForm';
import { FederatedOptions } from '../federated';
import { BrandPanel } from '../layout/BrandPanel';
import { recoveryActionFor } from '../views/recoveryActions';

const values = { name: ' Ana Ruiz ', email: ' ana@example.com ', password: 'Long-enough-1' };

function fakeActions(overrides: Partial<AuthActions> = {}): AuthActions {
  return {
    signIn: vi.fn().mockResolvedValue(undefined),
    signUp: vi.fn().mockResolvedValue({ status: 'confirmEmail' }),
    sendPasswordReset: vi.fn().mockResolvedValue(undefined),
    resendConfirmation: vi.fn().mockResolvedValue(undefined),
    signInWithProvider: vi.fn().mockResolvedValue(undefined),
    signInWithSso: vi.fn().mockResolvedValue(undefined),
    cancelBrowserSignIn: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function context(actions = fakeActions()): SubmitContext {
  return { actions, goTo: vi.fn(), notify: vi.fn(), startCooldown: vi.fn(), awaitBrowser: vi.fn() };
}

describe('validateForm', () => {
  const empty = { name: '', email: '', password: '' };

  it('checks only the fields each form has', () => {
    expect(Object.keys(validateForm('signIn', empty)).sort()).toEqual(['email', 'password']);
    expect(Object.keys(validateForm('signUp', empty)).sort()).toEqual(['email', 'name', 'password']);
    expect(Object.keys(validateForm('forgot', empty))).toEqual(['email']);
    expect(Object.keys(validateForm('sso', empty))).toEqual(['email']);
  });

  it('passes a complete form', () => {
    expect(validateForm('signUp', values)).toEqual({});
  });

  it('accepts any non-empty password on sign in, but enforces length on sign up', () => {
    const short = { ...values, password: 'abc' };
    expect(validateForm('signIn', short)).toEqual({});
    expect(validateForm('signUp', short).password).toMatch(/at least 8/);
  });
});

describe('SUBMIT_HANDLERS', () => {
  it('trims the email and name but sends the password as typed', async () => {
    const ctx = context();
    await SUBMIT_HANDLERS.signUp({ ...values, password: ' spaced ' }, ctx);
    expect(ctx.actions.signUp).toHaveBeenCalledWith('ana@example.com', ' spaced ', 'Ana Ruiz');
  });

  it('moves to the inbox screen when sign-up needs confirmation', async () => {
    const ctx = context();
    await SUBMIT_HANDLERS.signUp(values, ctx);
    expect(ctx.goTo).toHaveBeenCalledWith('checkEmail');
    expect(ctx.startCooldown).toHaveBeenCalled();
  });

  it('stays put when sign-up signs the user straight in', async () => {
    const signedIn = { status: 'signedIn' as const, account: { configured: true, user: null, workspace: null } };
    const ctx = context(fakeActions({ signUp: vi.fn().mockResolvedValue(signedIn) }));
    await SUBMIT_HANDLERS.signUp(values, ctx);
    expect(ctx.goTo).not.toHaveBeenCalled();
  });

  it('confirms a reset without saying whether the account exists', async () => {
    const ctx = context();
    await SUBMIT_HANDLERS.forgot(values, ctx);
    expect(ctx.actions.sendPasswordReset).toHaveBeenCalledWith('ana@example.com');
    expect(ctx.notify).toHaveBeenCalledWith(expect.stringMatching(/If an account exists for ana@example.com/));
  });
});

describe('SUBMIT_HANDLERS.sso', () => {
  it('waits on the browser for company SSO with the trimmed email', async () => {
    const ctx = context();
    await SUBMIT_HANDLERS.sso(values, ctx);
    expect(ctx.awaitBrowser).toHaveBeenCalledWith({ kind: 'sso', email: 'ana@example.com' });
    expect(ctx.actions.signInWithSso).toHaveBeenCalledWith('ana@example.com');
  });
});

describe('FederatedOptions', () => {
  const none = { providers: [], companySso: false };

  it('renders nothing when no browser sign-in is set up', () => {
    const { container } = render(<FederatedOptions methods={none} onProvider={vi.fn()} onCompanySso={vi.fn()} disabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers each configured provider and company SSO', () => {
    const onProvider = vi.fn();
    const onCompanySso = vi.fn();
    render(
      <FederatedOptions methods={{ providers: ['azure', 'google'], companySso: true }} onProvider={onProvider} onCompanySso={onCompanySso} disabled={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Microsoft' }));
    expect(onProvider).toHaveBeenCalledWith('azure');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with company SSO' }));
    expect(onCompanySso).toHaveBeenCalled();
    expect(screen.getByText('or with email')).toBeInTheDocument();
  });
});

describe('recoveryActionFor', () => {
  const ctx = { busy: false, cooldown: 0, switchMode: vi.fn(), resendConfirmation: vi.fn() };

  it('offers sign in when the account already exists', () => {
    render(<>{recoveryActionFor('user_exists', ctx)}</>);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in instead' }));
    expect(ctx.switchMode).toHaveBeenCalledWith('signIn');
  });

  it('counts down the resend action during a cooldown', () => {
    render(<>{recoveryActionFor('email_not_confirmed', { ...ctx, cooldown: 12 })}</>);
    expect(screen.getByRole('button', { name: 'Resend confirmation email (12s)' })).toBeDisabled();
  });

  it('offers nothing for errors with no recovery', () => {
    expect(recoveryActionFor('network', ctx)).toBeUndefined();
  });
});

describe('BrandPanel', () => {
  it('shows every trust point', () => {
    render(<BrandPanel />);
    for (const point of TRUST_POINTS) expect(screen.getByText(point.text)).toBeInTheDocument();
  });
});

describe('StepIndicator', () => {
  it('marks the current step', () => {
    render(<StepIndicator steps={['Account', 'Verify email', 'Start']} current={1} />);
    expect(screen.getByLabelText('Step 2 of 3')).toBeInTheDocument();
    expect(screen.getByText('Verify email').closest('li')).toHaveAttribute('aria-current', 'step');
  });
});
