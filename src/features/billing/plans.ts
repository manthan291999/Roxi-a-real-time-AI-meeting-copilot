/**
 * Plans and prices, in pounds sterling. The website shows the same catalogue
 * from `website/src/lib/plans.ts`; change both together.
 *
 * Prices are whole pence so formatting never meets a float.
 */
export type PlanId = 'free' | 'pro' | 'team' | 'enterprise';

export interface Plan {
  id: PlanId;
  name: string;
  /** null for Enterprise, which is quoted. */
  pricePence: number | null;
  /** Under the price: "per month", "per user / month". */
  period: string;
  blurb: string;
  features: string[];
  /** The plan the upgrade screen points at first. */
  recommended?: boolean;
}

/** Five minutes. Mirrors `TRIAL_SECONDS` in `src-tauri/src/application/trial_usecase.rs`. */
export const TRIAL_MINUTES = 5;

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free trial',
    pricePence: 0,
    period: `${TRIAL_MINUTES} minutes of live capture`,
    blurb: 'Try every feature on a real meeting.',
    features: ['Live transcript with speaker labels', 'Plain-English explanations', 'Action items and risk alerts', 'Ask Roxi about the meeting'],
  },
  {
    id: 'pro',
    name: 'Pro',
    pricePence: 1200,
    period: 'per month',
    blurb: 'For people who spend their day in meetings.',
    features: ['Unlimited live capture', 'Suggested replies as you talk', 'Full meeting history and search', 'Ask Roxi across meetings, documents and the web', 'Project library with document upload'],
    recommended: true,
  },
  {
    id: 'team',
    name: 'Team',
    pricePence: 2000,
    period: 'per user / month',
    blurb: 'One shared workspace for the whole team.',
    features: ['Everything in Pro', 'Shared cloud workspace', 'Owner, admin and member roles', 'Import existing meeting history', 'Microsoft and Google sign-in'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    pricePence: null,
    period: 'tailored to your organisation',
    blurb: 'For organisations with security and rollout needs.',
    features: ['Everything in Team', 'Company single sign-on (SSO)', 'Custom data retention', 'Priority support'],
  },
];

const WHOLE_POUNDS = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const WITH_PENCE = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 });

/** `£12`, `£12.50`, or `Custom` for a quoted plan. */
export function formatPrice(pence: number | null): string {
  if (pence === null) return 'Custom';
  return (pence % 100 === 0 ? WHOLE_POUNDS : WITH_PENCE).format(pence / 100);
}

export function planName(id: string): string {
  return PLANS.find((p) => p.id === id)?.name.replace(' trial', '') ?? id;
}

/**
 * Where "Choose plan" sends people: the website's pricing page, set with
 * VITE_PRICING_URL in the root .env. Unset means checkout is not live yet,
 * and the buttons say so rather than opening a page that does not exist.
 */
export const PRICING_URL: string | null = import.meta.env.VITE_PRICING_URL?.trim() || null;

export function checkoutUrl(plan: PlanId): string | null {
  if (!PRICING_URL) return null;
  const url = new URL(PRICING_URL);
  url.searchParams.set('plan', plan);
  return url.toString();
}
