import { validateEmail, validateName, validateNewPassword } from '../validation';
import { AuthFieldName, AuthFormValues, FieldErrors, FormMode } from './types';

type Rules = Partial<Record<AuthFieldName, (value: string) => string | null>>;

const requirePassword = (password: string) => (password ? null : 'Enter your password.');

/**
 * Which fields each form checks, and how. A new form adds an entry here;
 * nothing else in the flow changes.
 */
const RULES: Record<FormMode, Rules> = {
  signIn: { email: validateEmail, password: requirePassword },
  signUp: { name: validateName, email: validateEmail, password: validateNewPassword },
  forgot: { email: validateEmail },
  sso: { email: validateEmail },
};

/** Client-side checks for one form. An empty result means it can be sent. */
export function validateForm(mode: FormMode, values: AuthFormValues): FieldErrors {
  const errors: FieldErrors = {};
  for (const [field, rule] of Object.entries(RULES[mode]) as [AuthFieldName, (value: string) => string | null][]) {
    const message = rule(values[field]);
    if (message) errors[field] = message;
  }
  return errors;
}
