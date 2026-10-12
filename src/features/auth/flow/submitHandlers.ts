import { AuthActions, AuthFormValues, AuthMode, BrowserSignIn, FormMode } from './types';

/** What a submit handler may do besides calling the account service. */
export interface SubmitContext {
  actions: AuthActions;
  goTo: (mode: AuthMode) => void;
  notify: (message: string) => void;
  startCooldown: () => void;
  /** Marks the flow as waiting on the browser until the handler settles. */
  awaitBrowser: (signIn: BrowserSignIn) => void;
}

type SubmitHandler = (values: AuthFormValues, ctx: SubmitContext) => Promise<void>;

/**
 * What each form does once its fields pass validation. Values arrive
 * untrimmed; the password is sent exactly as typed.
 */
export const SUBMIT_HANDLERS: Record<FormMode, SubmitHandler> = {
  signIn: (values, { actions }) => actions.signIn(values.email.trim(), values.password),

  signUp: async (values, { actions, goTo, startCooldown }) => {
    const result = await actions.signUp(values.email.trim(), values.password, values.name.trim());
    if (result.status === 'confirmEmail') {
      goTo('checkEmail');
      startCooldown();
    }
  },

  forgot: async (values, { actions, notify, startCooldown }) => {
    const email = values.email.trim();
    await actions.sendPasswordReset(email);
    notify(`If an account exists for ${email}, a reset link is on its way. Check your inbox.`);
    startCooldown();
  },

  sso: (values, { actions, awaitBrowser }) => {
    const email = values.email.trim();
    awaitBrowser({ kind: 'sso', email });
    return actions.signInWithSso(email);
  },
};
