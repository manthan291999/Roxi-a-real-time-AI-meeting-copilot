import React from 'react';
import { OAuthProviderId } from '../../../shared/types/account';

/*
 * Third-party logos keep the colours their owners' brand guidelines require,
 * so they are the one place colour literals are allowed: they are marks, not
 * part of Roxi's theme, and must not change when the theme does.
 */

const MicrosoftMark: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="0" y="0" width="7.5" height="7.5" fill="#F25022" />
    <rect x="8.5" y="0" width="7.5" height="7.5" fill="#7FBA00" />
    <rect x="0" y="8.5" width="7.5" height="7.5" fill="#00A4EF" />
    <rect x="8.5" y="8.5" width="7.5" height="7.5" fill="#FFB900" />
  </svg>
);

const GoogleMark: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
    <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z" />
  </svg>
);

export interface ProviderEntry {
  /** Short name for buttons ("Microsoft"). */
  label: string;
  mark: React.FC;
}

/** How each provider is shown. Supporting a new one is an entry here (and in Rust). */
export const PROVIDER_CATALOG: Record<OAuthProviderId, ProviderEntry> = {
  azure: { label: 'Microsoft', mark: MicrosoftMark },
  google: { label: 'Google', mark: GoogleMark },
};
