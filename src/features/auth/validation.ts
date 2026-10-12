/**
 * Client-side checks that run before any request. They catch typos early;
 * Supabase still enforces its own rules, and its errors are shown as sent.
 */

export const MIN_PASSWORD_LENGTH = 8;

export function validateEmail(email: string): string | null {
  const value = email.trim();
  if (!value) return 'Enter your email address.';
  // Deliberately loose: one @, something before it, a dot after it.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email address, like name@company.com.';
  return null;
}

export function validateNewPassword(password: string): string | null {
  if (!password) return 'Choose a password.';
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  return null;
}

export function validateName(name: string): string | null {
  return name.trim() ? null : 'Enter your name.';
}

export type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: string };

/** A rough guide for the meter under the sign-up password field. */
export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: '' };
  let score = 0;
  if (password.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  if (password.length < MIN_PASSWORD_LENGTH) score = Math.min(score, 1);
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
  const clamped = Math.max(1, score) as PasswordStrength['score'];
  return { score: clamped, label: password.length < MIN_PASSWORD_LENGTH ? labels[0] : labels[clamped] };
}
