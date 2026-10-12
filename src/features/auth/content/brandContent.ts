import type React from 'react';
import { brandTokens, LaptopIcon, LockIcon, ShieldCheckIcon } from '../../../design-system';

/**
 * What the brand panel says. Data only: the panel's components render
 * whatever is here, so the pitch can change without touching layout.
 */
export const BRAND_PITCH = {
  headline: 'Every meeting, understood as it happens.',
  body: 'Live explanations, action items, risk alerts and suggested replies for Zoom, Google Meet, Teams and Slack.',
};

export interface PreviewTag {
  label: string;
  text: string;
  color: string;
  background: string;
}

/** An illustrative moment from a meeting — what Roxi shows, not real data. */
export const LIVE_PREVIEW = {
  meeting: 'Q3 vendor review',
  time: '12:04',
  speaker: 'Speaker 2',
  line: 'We can move forward once the SLA is revised to cover weekend outages.',
  tags: [
    {
      label: 'Meaning',
      text: 'They will not sign until weekend support is written into the contract.',
      color: brandTokens.meaning,
      background: brandTokens.meaningBg,
    },
    {
      label: 'Action',
      text: 'Send a revised SLA draft to Speaker 2.',
      color: brandTokens.action,
      background: brandTokens.actionBg,
    },
    {
      label: 'Risk',
      text: 'Signing may slip past quarter end.',
      color: brandTokens.risk,
      background: brandTokens.riskBg,
    },
  ] satisfies PreviewTag[],
};

export interface TrustPoint {
  icon: React.FC<{ className?: string; style?: React.CSSProperties }>;
  text: string;
}

/** Each claim here must stay true of the app: check before editing. */
export const TRUST_POINTS: TrustPoint[] = [
  { icon: LockIcon, text: 'Session kept in the macOS Keychain' },
  { icon: ShieldCheckIcon, text: 'Meetings private to your workspace' },
  { icon: LaptopIcon, text: 'History stays on this Mac until you import it' },
];
