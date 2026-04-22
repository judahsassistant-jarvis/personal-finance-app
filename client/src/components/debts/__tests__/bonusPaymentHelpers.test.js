import { describe, it, expect } from 'vitest';
import { DEBT_SUBTYPES } from '../../../firebase/schema.js';
import {
  computeBonusPaymentImpact,
  dateInputToMonthIndex,
  currentMonthInputValue,
} from '../bonusPaymentHelpers.js';

describe('computeBonusPaymentImpact', () => {
  const setup = () => ({
    debts: [{
      id: 'd1', subtype: DEBT_SUBTYPES.CARD, name: 'Card',
      balance_pennies: 500000, standard_apr: 0.20, min_percentage: 0.02, min_floor_pennies: 2500,
    }],
    buckets: [{ id: 'b1', debt_id: 'd1', name: 'P', balance_pennies: 500000, apr: 0.20, is_promo: false }],
    startMonth: '2026-05-01',
    months: 120,
    monthlyBudget: 30000,
    strategy: 'avalanche',
  });

  it('returns baseline and withBonus summaries with non-negative deltas', () => {
    const out = computeBonusPaymentImpact({
      ...setup(),
      injectionMonthIndex: 0,
      amountPennies: 100000,
    });
    expect(out.baseline.totalInterestPennies).toBeGreaterThan(0);
    expect(out.withBonus.totalInterestPennies).toBeLessThanOrEqual(out.baseline.totalInterestPennies);
    expect(out.interestSavedPennies).toBeGreaterThanOrEqual(0);
    expect(out.monthsSaved).toBeGreaterThanOrEqual(0);
  });

  it('a meaningful bonus saves both interest and months', () => {
    const out = computeBonusPaymentImpact({
      ...setup(),
      injectionMonthIndex: 0,
      amountPennies: 100000,
    });
    expect(out.interestSavedPennies).toBeGreaterThan(0);
    expect(out.monthsSaved).toBeGreaterThan(0);
  });

  it('a zero-amount bonus reports no savings and no month change', () => {
    const out = computeBonusPaymentImpact({
      ...setup(),
      injectionMonthIndex: 0,
      amountPennies: 0,
    });
    expect(out.interestSavedPennies).toBe(0);
    expect(out.monthsSaved).toBe(0);
  });

  it('exposes the month label the injection was applied to', () => {
    const out = computeBonusPaymentImpact({
      ...setup(),
      injectionMonthIndex: 2,
      amountPennies: 50000,
    });
    // startMonth '2026-05-01' + 2 months = 2026-07
    expect(out.injectionAppliedMonth).toMatch(/^2026-07/);
  });

  it('injecting later saves less interest than injecting earlier (all else equal)', () => {
    const base = setup();
    const earlier = computeBonusPaymentImpact({ ...base, injectionMonthIndex: 0, amountPennies: 100000 });
    const later = computeBonusPaymentImpact({ ...base, injectionMonthIndex: 6, amountPennies: 100000 });
    expect(earlier.interestSavedPennies).toBeGreaterThan(later.interestSavedPennies);
  });
});

describe('dateInputToMonthIndex', () => {
  const startMonth = new Date(2026, 4, 1); // May 2026

  it('returns 0 for the start month', () => {
    expect(dateInputToMonthIndex('2026-05', startMonth)).toBe(0);
  });

  it('counts months forward', () => {
    expect(dateInputToMonthIndex('2026-06', startMonth)).toBe(1);
    expect(dateInputToMonthIndex('2027-05', startMonth)).toBe(12);
    expect(dateInputToMonthIndex('2028-07', startMonth)).toBe(26);
  });

  it('returns null for dates before the start month', () => {
    expect(dateInputToMonthIndex('2026-04', startMonth)).toBe(null);
    expect(dateInputToMonthIndex('2025-12', startMonth)).toBe(null);
  });

  it('returns null for malformed input', () => {
    expect(dateInputToMonthIndex('', startMonth)).toBe(null);
    expect(dateInputToMonthIndex(null, startMonth)).toBe(null);
    expect(dateInputToMonthIndex('not-a-date', startMonth)).toBe(null);
    expect(dateInputToMonthIndex('2026-13', startMonth)).toBe(null); // invalid month
  });
});

describe('currentMonthInputValue', () => {
  it('returns "YYYY-MM" for the given date', () => {
    expect(currentMonthInputValue(new Date(2026, 0, 15))).toBe('2026-01');
    expect(currentMonthInputValue(new Date(2026, 9, 1))).toBe('2026-10');
    expect(currentMonthInputValue(new Date(2030, 11, 31))).toBe('2030-12');
  });
});
