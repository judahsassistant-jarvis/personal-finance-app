/**
 * Unit tests for helpers extracted from DebtPlanner page.
 * Kept alongside the page until promoted to a shared module.
 */
import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { computePromoInfo, computeWeightedApr } from '../DebtPlanner.jsx';

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
