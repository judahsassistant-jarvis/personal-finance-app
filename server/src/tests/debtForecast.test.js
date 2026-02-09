const { getEffectiveApr, calcMinPayment, getAvalancheScore } = require('../services/debtForecast');

describe('Debt Forecast Engine - Pure Functions', () => {
  describe('getEffectiveApr', () => {
    const makeCard = (standard_apr) => ({ standard_apr });

    test('returns 0 for zero-balance bucket', () => {
      const bucket = { balance: 0, promo_apr: 0.05, promo_end_date: '2027-01-01' };
      expect(getEffectiveApr(bucket, makeCard(0.199), new Date('2026-06-01'))).toBe(0);
    });

    test('returns 0 for negative-balance bucket', () => {
      const bucket = { balance: -10, promo_apr: 0.05, promo_end_date: '2027-01-01' };
      expect(getEffectiveApr(bucket, makeCard(0.199), new Date('2026-06-01'))).toBe(0);
    });

    test('returns promo APR before promo end date', () => {
      const bucket = { balance: 1000, promo_apr: 0.0, promo_end_date: '2026-08-01' };
      expect(getEffectiveApr(bucket, makeCard(0.199), new Date('2026-06-01'))).toBe(0);
    });

    test('returns standard APR after promo expiry', () => {
      const bucket = { balance: 1000, promo_apr: 0.0, promo_end_date: '2026-08-01' };
      expect(getEffectiveApr(bucket, makeCard(0.199), new Date('2026-09-01'))).toBe(0.199);
    });

    test('returns promo APR on exact promo end date', () => {
      const bucket = { balance: 1000, promo_apr: 0.0, promo_end_date: '2026-08-01' };
      expect(getEffectiveApr(bucket, makeCard(0.199), new Date('2026-08-01'))).toBe(0);
    });

    test('returns permanent promo APR when no end date', () => {
      const bucket = { balance: 1000, promo_apr: 0.05, promo_end_date: null };
      expect(getEffectiveApr(bucket, makeCard(0.199), new Date('2026-06-01'))).toBe(0.05);
    });

    test('returns card standard APR when no promo at all', () => {
      const bucket = { balance: 1000, promo_apr: null, promo_end_date: null };
      expect(getEffectiveApr(bucket, makeCard(0.199), new Date('2026-06-01'))).toBe(0.199);
    });

    test('normalizes APR > 1 (user typed 20 instead of 0.20)', () => {
      const bucket = { balance: 1000, promo_apr: null, promo_end_date: null };
      expect(getEffectiveApr(bucket, makeCard(20), new Date('2026-06-01'))).toBe(0.2);
    });

    test('normalizes promo APR > 1', () => {
      const bucket = { balance: 1000, promo_apr: 5, promo_end_date: '2027-01-01' };
      expect(getEffectiveApr(bucket, makeCard(0.199), new Date('2026-06-01'))).toBe(0.05);
    });

    test('handles zero standard APR', () => {
      const bucket = { balance: 1000, promo_apr: null, promo_end_date: null };
      expect(getEffectiveApr(bucket, makeCard(0), new Date('2026-06-01'))).toBe(0);
    });

    test('handles missing standard_apr (undefined)', () => {
      const bucket = { balance: 1000, promo_apr: null, promo_end_date: null };
      expect(getEffectiveApr(bucket, { standard_apr: undefined }, new Date('2026-06-01'))).toBe(0);
    });
  });

  describe('calcMinPayment', () => {
    const makeCard = (min_percentage, min_floor) => ({ min_percentage, min_floor });

    test('returns percentage-based minimum when higher than floor', () => {
      // 2% of £5000 = £100, floor = £25, so £100
      expect(calcMinPayment(makeCard(0.02, 25), 5000)).toBe(100);
    });

    test('returns floor when higher than percentage', () => {
      // 2% of £500 = £10, floor = £25, so £25
      expect(calcMinPayment(makeCard(0.02, 25), 500)).toBe(25);
    });

    test('returns balance when less than calculated minimum', () => {
      // 2% of £10 = £0.20, floor = £25, but balance is only £10
      expect(calcMinPayment(makeCard(0.02, 25), 10)).toBe(10);
    });

    test('returns 0 for zero balance', () => {
      expect(calcMinPayment(makeCard(0.02, 25), 0)).toBe(0);
    });

    test('returns 0 for negative balance', () => {
      expect(calcMinPayment(makeCard(0.02, 25), -100)).toBe(0);
    });

    test('uses defaults when fields are missing', () => {
      // Default 2% of £5000 = £100, default floor £25
      expect(calcMinPayment({}, 5000)).toBe(100);
    });

    test('handles very small balance correctly', () => {
      // 2% of £1 = £0.02, floor = £25, but balance is £1
      expect(calcMinPayment(makeCard(0.02, 25), 1)).toBe(1);
    });

    test('handles large balance correctly', () => {
      // 2% of £100,000 = £2,000
      expect(calcMinPayment(makeCard(0.02, 25), 100000)).toBe(2000);
    });
  });

  describe('getAvalancheScore', () => {
    test('higher APR gets higher score', () => {
      const score20 = getAvalancheScore(0.20, 0);
      const score18 = getAvalancheScore(0.18, 0);
      expect(score20).toBeGreaterThan(score18);
    });

    test('same APR, lower position index gets higher score', () => {
      const score0 = getAvalancheScore(0.20, 0);
      const score1 = getAvalancheScore(0.20, 1);
      expect(score0).toBeGreaterThan(score1);
    });

    test('APR difference dominates position', () => {
      // Even with worst position, higher APR should still win
      const highAprBadPosition = getAvalancheScore(0.20, 29);
      const lowAprGoodPosition = getAvalancheScore(0.19, 0);
      expect(highAprBadPosition).toBeGreaterThan(lowAprGoodPosition);
    });

    test('score matches spec formula', () => {
      // score = effectiveApr * 1_000_000 + (30 - positionIndex) / 1000
      expect(getAvalancheScore(0.20, 1)).toBeCloseTo(200000 + 29 / 1000, 6);
    });

    test('zero APR gets position-only score', () => {
      const score = getAvalancheScore(0, 5);
      expect(score).toBeCloseTo(25 / 1000, 6);
    });
  });
});
