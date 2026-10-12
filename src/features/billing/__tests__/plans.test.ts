import { describe, expect, it } from 'vitest';
import { PLANS, TRIAL_MINUTES, formatPrice, planName } from '../plans';

describe('plans', () => {
  it('formats prices in pounds sterling', () => {
    expect(formatPrice(0)).toBe('£0');
    expect(formatPrice(1200)).toBe('£12');
    expect(formatPrice(1250)).toBe('£12.50');
    expect(formatPrice(null)).toBe('Custom');
  });

  it('offers a five-minute free trial and one recommended plan', () => {
    expect(TRIAL_MINUTES).toBe(5);
    expect(PLANS[0].id).toBe('free');
    expect(PLANS.filter((p) => p.recommended).map((p) => p.id)).toEqual(['pro']);
  });

  it('names plans without the trial suffix', () => {
    expect(planName('free')).toBe('Free');
    expect(planName('team')).toBe('Team');
  });
});
