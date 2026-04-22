/**
 * Unit tests for helpers extracted from DebtPlanner page.
 * Kept alongside the page until promoted to a shared module.
 */
import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  computePromoInfo,
  computeWeightedApr,
  computeUtilisation,
  UTILISATION_THRESHOLDS,
  computePayoffProgress,
} from '../debtPlannerHelpers.js';

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

describe('computePromoInfo', () => {
  it('returns null when no buckets are promo', () => {
    const buckets = [
      { name: 'Purchases', apr: 0.2, is_promo: false, balance_pennies: 1000 },
    ];
    expect(computePromoInfo(buckets)).toBeNull();
  });

  it('finds the soonest active promo and returns day countdown', () => {
    const buckets = [
      { name: 'Purchases', apr: 0.2, is_promo: false, balance_pennies: 1000 },
      { name: 'BT', apr: 0, is_promo: true, promo_end: daysFromNow(60), balance_pennies: 2000 },
      { name: 'BT2', apr: 0, is_promo: true, promo_end: daysFromNow(20), balance_pennies: 500 },
    ];
    const info = computePromoInfo(buckets);
    expect(info).not.toBeNull();
    expect(info.days).toBeGreaterThanOrEqual(19);
    expect(info.days).toBeLessThanOrEqual(21);
    expect(info.bucketName).toBe('BT2');
  });

  it('handles Firestore Timestamp promo_end (has toDate method)', () => {
    const buckets = [
      { name: 'BT', apr: 0, is_promo: true, promo_end: Timestamp.fromDate(daysFromNow(45)), balance_pennies: 1000 },
    ];
    const info = computePromoInfo(buckets);
    expect(info).not.toBeNull();
    expect(info.days).toBeGreaterThanOrEqual(44);
    expect(info.days).toBeLessThanOrEqual(46);
  });

  it('handles Redux-serialised promo_end (epoch millis number)', () => {
    const buckets = [
      { name: 'BT', apr: 0, is_promo: true, promo_end: daysFromNow(45).getTime(), balance_pennies: 1000 },
    ];
    const info = computePromoInfo(buckets);
    expect(info).not.toBeNull();
    expect(info.days).toBeGreaterThanOrEqual(44);
    expect(info.days).toBeLessThanOrEqual(46);
  });

  it('ignores expired promos', () => {
    const buckets = [
      { name: 'Old BT', apr: 0, is_promo: true, promo_end: daysFromNow(-5), balance_pennies: 1000 },
    ];
    expect(computePromoInfo(buckets)).toBeNull();
  });
});

describe('computeWeightedApr', () => {
  it('returns balance-weighted average across buckets', () => {
    const buckets = [
      { apr: 0.2, is_promo: false, balance_pennies: 1000 },
      { apr: 0.1, is_promo: false, balance_pennies: 3000 },
    ];
    // (1000 * 0.2 + 3000 * 0.1) / 4000 = 0.125
    expect(computeWeightedApr(buckets)).toBeCloseTo(0.125, 5);
  });

  it('uses 0% for active promo buckets', () => {
    const buckets = [
      { apr: 0, is_promo: true, promo_end: daysFromNow(30), balance_pennies: 2000 },
      { apr: 0.25, is_promo: false, balance_pennies: 500 },
    ];
    // (2000 * 0 + 500 * 0.25) / 2500 = 0.05
    expect(computeWeightedApr(buckets)).toBeCloseTo(0.05, 5);
  });

  it('returns 0 on empty bucket array', () => {
    expect(computeWeightedApr([])).toBe(0);
  });
});

describe('computeUtilisation', () => {
  it('returns null when the debt has no limit_pennies', () => {
    expect(computeUtilisation({}, 10000)).toBeNull();
    expect(computeUtilisation({ limit_pennies: 0 }, 10000)).toBeNull();
    expect(computeUtilisation({ limit_pennies: null }, 10000)).toBeNull();
  });

  it('classifies ratios below 30% as good (green)', () => {
    // £2,900 on a £10,000 limit = 29%
    const u = computeUtilisation({ limit_pennies: 1000000 }, 290000);
    expect(u.band).toBe('good');
    expect(u.ratio).toBeCloseTo(0.29, 5);
    expect(u.overLimit).toBe(false);
  });

  it('classifies ratios at the 30% threshold as fair (amber)', () => {
    // Exactly 30% is the lower edge of the fair band.
    const u = computeUtilisation({ limit_pennies: 1000000 }, 300000);
    expect(u.band).toBe('fair');
  });

  it('classifies ratios below 75% as fair (amber)', () => {
    const u = computeUtilisation({ limit_pennies: 1000000 }, 740000);
    expect(u.band).toBe('fair');
  });

  it('classifies ratios at or above 75% as poor (red)', () => {
    // At the threshold: poor.
    expect(computeUtilisation({ limit_pennies: 1000000 }, 750000).band).toBe('poor');
    // Clearly into poor territory.
    expect(computeUtilisation({ limit_pennies: 1000000 }, 900000).band).toBe('poor');
  });

  it('flags overLimit when balance exceeds limit and reports the true ratio', () => {
    // £1,250 on a £1,000 limit = 125% utilisation.
    const u = computeUtilisation({ limit_pennies: 100000 }, 125000);
    expect(u.overLimit).toBe(true);
    expect(u.ratio).toBeCloseTo(1.25, 5);
    expect(u.band).toBe('poor');
  });

  it('clamps negative balance to zero (credit balance on card)', () => {
    const u = computeUtilisation({ limit_pennies: 1000000 }, -5000);
    expect(u.ratio).toBe(0);
    expect(u.band).toBe('good');
    expect(u.overLimit).toBe(false);
  });

  it('exports thresholds consumers can reference', () => {
    expect(UTILISATION_THRESHOLDS.GOOD).toBe(0.30);
    expect(UTILISATION_THRESHOLDS.FAIR).toBe(0.75);
  });
});

describe('computePayoffProgress', () => {
  it('returns null when the debt has no starting_balance', () => {
    expect(computePayoffProgress({}, 10000)).toBeNull();
    expect(computePayoffProgress({ starting_balance_pennies: 0 }, 10000)).toBeNull();
    expect(computePayoffProgress({ starting_balance_pennies: null }, 10000)).toBeNull();
  });

  it('returns 0% for a brand-new debt (balance == starting)', () => {
    const p = computePayoffProgress({ starting_balance_pennies: 500000 }, 500000);
    expect(p.progressRatio).toBe(0);
    expect(p.paidPennies).toBe(0);
    expect(p.remainingPennies).toBe(500000);
  });

  it('returns 100% for a fully paid debt', () => {
    const p = computePayoffProgress({ starting_balance_pennies: 500000 }, 0);
    expect(p.progressRatio).toBe(1);
    expect(p.paidPennies).toBe(500000);
    expect(p.remainingPennies).toBe(0);
  });

  it('returns the expected fraction mid-way through', () => {
    // £6,000 starting, £4,500 balance → 25% paid off
    const p = computePayoffProgress({ starting_balance_pennies: 600000 }, 450000);
    expect(p.progressRatio).toBeCloseTo(0.25, 5);
    expect(p.paidPennies).toBe(150000);
    expect(p.remainingPennies).toBe(450000);
  });

  it('clamps to 0 when balance exceeds starting (e.g. interest pushed it up)', () => {
    const p = computePayoffProgress({ starting_balance_pennies: 100000 }, 120000);
    expect(p.progressRatio).toBe(0);
    expect(p.paidPennies).toBe(0);
  });

  it('exposes startingPennies so the UI can render the reference amount', () => {
    const p = computePayoffProgress({ starting_balance_pennies: 100000 }, 50000);
    expect(p.startingPennies).toBe(100000);
  });
});
