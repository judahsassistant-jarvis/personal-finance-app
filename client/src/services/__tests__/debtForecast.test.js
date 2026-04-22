import { describe, test, expect } from 'vitest';
import {
  getEffectiveApr,
  calcCardMinPayment,
  calcInstallmentMinPayment,
  calcRevolvingMinPayment,
  getAvalancheScore,
  getSnowballScore,
  getHybridScore,
  runForecast,
} from '../debtForecast.js';
import { DEBT_SUBTYPES, SMALL_BALANCE_BOOST_THRESHOLD_PENNIES } from '../../firebase/schema.js';

// -------------------------------------------------------------------
// Pure helpers
// -------------------------------------------------------------------

describe('getEffectiveApr', () => {
  const makeDebt = (standard_apr) => ({ standard_apr });
  const inPromo = (end) => ({ balance_pennies: 100000, apr: 0, is_promo: true, promo_end: end });

  test('zero balance bucket returns 0', () => {
    const bucket = { balance_pennies: 0, apr: 0.05, is_promo: true, promo_end: new Date('2027-01-01') };
    expect(getEffectiveApr(bucket, makeDebt(0.199), new Date('2026-06-01'))).toBe(0);
  });

  test('negative balance bucket returns 0', () => {
    const bucket = { balance_pennies: -10, apr: 0.05, is_promo: true, promo_end: new Date('2027-01-01') };
    expect(getEffectiveApr(bucket, makeDebt(0.199), new Date('2026-06-01'))).toBe(0);
  });

  test('promo APR before end date', () => {
    expect(getEffectiveApr(inPromo(new Date('2026-08-01')), makeDebt(0.199), new Date('2026-06-01'))).toBe(0);
  });

  test('standard APR after promo expiry', () => {
    expect(getEffectiveApr(inPromo(new Date('2026-08-01')), makeDebt(0.199), new Date('2026-09-01'))).toBe(0.199);
  });

  test('promo APR on exact end date', () => {
    expect(getEffectiveApr(inPromo(new Date('2026-08-01')), makeDebt(0.199), new Date('2026-08-01'))).toBe(0);
  });

  test('permanent promo rate (no end date)', () => {
    const bucket = { balance_pennies: 100000, apr: 0.05, is_promo: true, promo_end: null };
    expect(getEffectiveApr(bucket, makeDebt(0.199), new Date('2026-06-01'))).toBe(0.05);
  });

  test('no promo → standard APR', () => {
    const bucket = { balance_pennies: 100000, apr: 0.199, is_promo: false, promo_end: null };
    expect(getEffectiveApr(bucket, makeDebt(0.199), new Date('2026-06-01'))).toBe(0.199);
  });

  test('normalises APR > 1 (user typed 20 instead of 0.20)', () => {
    const bucket = { balance_pennies: 100000, apr: 0.199, is_promo: false };
    expect(getEffectiveApr(bucket, makeDebt(20), new Date('2026-06-01'))).toBe(0.2);
  });

  test('zero standard APR', () => {
    const bucket = { balance_pennies: 100000, apr: 0, is_promo: false };
    expect(getEffectiveApr(bucket, makeDebt(0), new Date('2026-06-01'))).toBe(0);
  });
});

describe('calcCardMinPayment', () => {
  const card = (min_percentage, min_floor_pennies) => ({ min_percentage, min_floor_pennies });

  test('percentage-based minimum when higher than floor', () => {
    // 2% of 500000p (£5000) = 10000p; floor 2500p → 10000p
    expect(calcCardMinPayment(card(0.02, 2500), 500000)).toBe(10000);
  });

  test('floor when higher than percentage', () => {
    // 2% of 50000p (£500) = 1000p; floor 2500p → 2500p
    expect(calcCardMinPayment(card(0.02, 2500), 50000)).toBe(2500);
  });

  test('balance if less than calculated minimum', () => {
    // 2% of 1000p (£10) = 20p; floor 2500p; balance is 1000p → 1000p
    expect(calcCardMinPayment(card(0.02, 2500), 1000)).toBe(1000);
  });

  test('zero balance', () => {
    expect(calcCardMinPayment(card(0.02, 2500), 0)).toBe(0);
  });

  test('negative balance', () => {
    expect(calcCardMinPayment(card(0.02, 2500), -100)).toBe(0);
  });

  test('uses defaults when fields missing', () => {
    // Default 2% of 500000p = 10000p
    expect(calcCardMinPayment({}, 500000)).toBe(10000);
  });

  test('large balance', () => {
    // 2% of 10_000_000p (£100k) = 200000p
    expect(calcCardMinPayment(card(0.02, 2500), 10_000_000)).toBe(200000);
  });
});

describe('calcInstallmentMinPayment', () => {
  test('returns fixed_payment when balance exceeds it', () => {
    expect(calcInstallmentMinPayment({ fixed_payment_pennies: 9000 }, 50000)).toBe(9000);
  });

  test('clipped at remaining balance (final payment)', () => {
    expect(calcInstallmentMinPayment({ fixed_payment_pennies: 9000 }, 2500)).toBe(2500);
  });

  test('zero balance', () => {
    expect(calcInstallmentMinPayment({ fixed_payment_pennies: 9000 }, 0)).toBe(0);
  });

  test('missing fixed_payment → 0', () => {
    expect(calcInstallmentMinPayment({}, 50000)).toBe(0);
  });
});

describe('calcRevolvingMinPayment', () => {
  test('always returns 0 (overdraft has no forced min)', () => {
    expect(calcRevolvingMinPayment({}, 100000)).toBe(0);
  });
});

describe('getAvalancheScore', () => {
  test('higher APR gets higher score', () => {
    expect(getAvalancheScore(0.20, 0)).toBeGreaterThan(getAvalancheScore(0.18, 0));
  });

  test('same APR, lower position index gets higher score', () => {
    expect(getAvalancheScore(0.20, 0)).toBeGreaterThan(getAvalancheScore(0.20, 1));
  });

  test('APR difference dominates position', () => {
    expect(getAvalancheScore(0.20, 29)).toBeGreaterThan(getAvalancheScore(0.19, 0));
  });

  test('matches spec formula', () => {
    expect(getAvalancheScore(0.20, 1)).toBeCloseTo(200000 + 29 / 1000, 6);
  });
});

describe('getSnowballScore', () => {
  test('smaller balance gets higher (less negative) score', () => {
    expect(getSnowballScore(100000)).toBeGreaterThan(getSnowballScore(500000));
  });
});

describe('getHybridScore', () => {
  test('without boost, matches avalanche score', () => {
    const big = SMALL_BALANCE_BOOST_THRESHOLD_PENNIES + 1;
    expect(getHybridScore(0.2, 0, big)).toBe(getAvalancheScore(0.2, 0));
  });

  test('below threshold, score = avalanche + 500_000 boost', () => {
    const small = SMALL_BALANCE_BOOST_THRESHOLD_PENNIES - 1;
    expect(getHybridScore(0.2, 0, small)).toBeCloseTo(getAvalancheScore(0.2, 0) + 500_000, 6);
  });

  test('boosted small debt outranks a much higher-APR large debt', () => {
    const smallScore = getHybridScore(0.05, 0, 10_000); // £100 @ 5%
    const bigScore = getHybridScore(0.40, 0, 500_000);  // £5,000 @ 40%
    expect(smallScore).toBeGreaterThan(bigScore);
  });

  test('at the threshold boundary (exactly £500), no boost applies', () => {
    expect(getHybridScore(0.1, 0, SMALL_BALANCE_BOOST_THRESHOLD_PENNIES))
      .toBe(getAvalancheScore(0.1, 0));
  });
});

// -------------------------------------------------------------------
// Integration
// -------------------------------------------------------------------

describe('runForecast — empty input', () => {
  test('no debts returns zero projection', () => {
    const r = runForecast({ debts: [], buckets: [], startMonth: '2026-05-01', months: 12 });
    expect(r.summary.totalDebtPennies).toBe(0);
    expect(r.months).toEqual([]);
  });

  test('all debts already paid off returns debt-free', () => {
    const debts = [{ id: 'd1', subtype: DEBT_SUBTYPES.CARD, balance_pennies: 0 }];
    const r = runForecast({ debts, buckets: [], startMonth: '2026-05-01', months: 12 });
    expect(r.months.length).toBeLessThanOrEqual(1);
  });
});

describe('runForecast — card_like', () => {
  test('single card with one bucket, budget = min, balance runs down', () => {
    const debts = [{
      id: 'd1',
      subtype: DEBT_SUBTYPES.CARD,
      name: 'TestCard',
      balance_pennies: 500000,
      standard_apr: 0,
      min_percentage: 0.02,
      min_floor_pennies: 2500,
    }];
    const buckets = [{
      id: 'b1', debt_id: 'd1', name: 'Purchases', balance_pennies: 500000, apr: 0, is_promo: false,
    }];
    const r = runForecast({ debts, buckets, startMonth: '2026-05-01', months: 12, monthlyBudget: null });
    // First month: 2% of 500000p = 10000p min
    expect(r.months[0].minimum_payments_pennies).toBe(10000);
    expect(r.months[0].ending_debt_pennies).toBe(490000);
  });

  test('extra budget accelerates payoff', () => {
    const debts = [{
      id: 'd1', subtype: DEBT_SUBTYPES.CARD, name: 'TestCard',
      balance_pennies: 500000, standard_apr: 0, min_percentage: 0.02, min_floor_pennies: 2500,
    }];
    const buckets = [{ id: 'b1', debt_id: 'd1', name: 'P', balance_pennies: 500000, apr: 0, is_promo: false }];
    const r = runForecast({ debts, buckets, startMonth: '2026-05-01', months: 24, monthlyBudget: 50000 });
    expect(r.debtFreeMonth).not.toBeNull();
    // £5000 at £500/mo = ~10 months (no interest)
    expect(r.months.length).toBeLessThanOrEqual(11);
  });

  test('BT cliff detection records event when promo expires', () => {
    const debts = [{
      id: 'bt1', subtype: DEBT_SUBTYPES.CARD, name: 'BT Card',
      balance_pennies: 280000, standard_apr: 0.249, min_percentage: 0.02, min_floor_pennies: 2500,
    }];
    const promoEnd = new Date('2026-07-01');
    const buckets = [{
      id: 'bt1b', debt_id: 'bt1', name: 'BT 0%',
      balance_pennies: 280000, apr: 0, is_promo: true, promo_end: promoEnd,
    }];
    const r = runForecast({ debts, buckets, startMonth: '2026-05-01', months: 12, monthlyBudget: 10000 });
    expect(r.cliffs.length).toBeGreaterThan(0);
    const cliff = r.cliffs[0];
    expect(cliff.debt_id).toBe('bt1');
    expect(cliff.from_apr).toBe(0);
    expect(cliff.to_apr).toBe(0.249);
  });
});

describe('runForecast — snowball vs avalanche', () => {
  const setup = () => {
    const debts = [
      { id: 'big', subtype: DEBT_SUBTYPES.CARD, name: 'BigHighAPR',
        balance_pennies: 500000, standard_apr: 0.25, min_percentage: 0.02, min_floor_pennies: 2500 },
      { id: 'small', subtype: DEBT_SUBTYPES.CARD, name: 'SmallLowAPR',
        balance_pennies: 100000, standard_apr: 0.15, min_percentage: 0.02, min_floor_pennies: 2500 },
    ];
    const buckets = [
      { id: 'big-b', debt_id: 'big', name: 'b', balance_pennies: 500000, apr: 0.25, is_promo: false },
      { id: 'small-b', debt_id: 'small', name: 'b', balance_pennies: 100000, apr: 0.15, is_promo: false },
    ];
    return { debts, buckets };
  };

  test('avalanche pays BigHighAPR first', () => {
    const { debts, buckets } = setup();
    const r = runForecast({ debts, buckets, startMonth: '2026-05-01', months: 2, monthlyBudget: 30000, strategy: 'avalanche' });
    const bigRow = r.months[0].per_debt.find((d) => d.debt_id === 'big');
    const smallRow = r.months[0].per_debt.find((d) => d.debt_id === 'small');
    expect(bigRow.payment_pennies).toBeGreaterThan(smallRow.payment_pennies);
  });

  test('snowball pays SmallLowAPR down first (smaller balance wins)', () => {
    const { debts, buckets } = setup();
    const r = runForecast({ debts, buckets, startMonth: '2026-05-01', months: 2, monthlyBudget: 30000, strategy: 'snowball' });
    const bigRow = r.months[0].per_debt.find((d) => d.debt_id === 'big');
    const smallRow = r.months[0].per_debt.find((d) => d.debt_id === 'small');
    expect(smallRow.payment_pennies).toBeGreaterThan(bigRow.payment_pennies);
  });
});

describe('runForecast — hybrid strategy', () => {
  test('with no sub-£500 debts, behaves like avalanche (highest APR first)', () => {
    const debts = [
      { id: 'big', subtype: DEBT_SUBTYPES.CARD, name: 'BigHighAPR',
        balance_pennies: 500000, standard_apr: 0.25, min_percentage: 0.02, min_floor_pennies: 2500 },
      { id: 'mid', subtype: DEBT_SUBTYPES.CARD, name: 'MidLowAPR',
        balance_pennies: 200000, standard_apr: 0.15, min_percentage: 0.02, min_floor_pennies: 2500 },
    ];
    const buckets = [
      { id: 'big-b', debt_id: 'big', name: 'b', balance_pennies: 500000, apr: 0.25, is_promo: false },
      { id: 'mid-b', debt_id: 'mid', name: 'b', balance_pennies: 200000, apr: 0.15, is_promo: false },
    ];
    const r = runForecast({ debts, buckets, startMonth: '2026-05-01', months: 2, monthlyBudget: 30000, strategy: 'hybrid' });
    const bigRow = r.months[0].per_debt.find((d) => d.debt_id === 'big');
    const midRow = r.months[0].per_debt.find((d) => d.debt_id === 'mid');
    expect(bigRow.payment_pennies).toBeGreaterThan(midRow.payment_pennies);
  });

  test('boosts a sub-£500 debt above a much higher-APR large debt', () => {
    // Big £5,000 @ 25% APR vs Small £400 @ 10% APR.
    // Avalanche would prioritise big. Hybrid should prioritise the small debt.
    const debts = [
      { id: 'big', subtype: DEBT_SUBTYPES.CARD, name: 'BigHighAPR',
        balance_pennies: 500000, standard_apr: 0.25, min_percentage: 0.02, min_floor_pennies: 2500 },
      { id: 'tiny', subtype: DEBT_SUBTYPES.CARD, name: 'TinyLowAPR',
        balance_pennies: 40000, standard_apr: 0.10, min_percentage: 0.02, min_floor_pennies: 2500 },
    ];
    const buckets = [
      { id: 'big-b', debt_id: 'big', name: 'b', balance_pennies: 500000, apr: 0.25, is_promo: false },
      { id: 'tiny-b', debt_id: 'tiny', name: 'b', balance_pennies: 40000, apr: 0.10, is_promo: false },
    ];
    const r = runForecast({ debts, buckets, startMonth: '2026-05-01', months: 2, monthlyBudget: 30000, strategy: 'hybrid' });
    const bigRow = r.months[0].per_debt.find((d) => d.debt_id === 'big');
    const tinyRow = r.months[0].per_debt.find((d) => d.debt_id === 'tiny');
    expect(tinyRow.payment_pennies).toBeGreaterThan(bigRow.payment_pennies);
  });
});

describe('runForecast — BNPL (installment, 0% APR)', () => {
  test('fixed monthly payment for term, then debt is cleared', () => {
    const debts = [{
      id: 'klarna', subtype: DEBT_SUBTYPES.BNPL, name: 'Klarna',
      balance_pennies: 54000, standard_apr: 0,
      fixed_payment_pennies: 9000, term_months: 6,
    }];
    const r = runForecast({ debts, buckets: [], startMonth: '2026-05-01', months: 12 });
    // 6 × £90 = £540 → clears at month 6
    expect(r.debtFreeMonth).not.toBeNull();
    expect(r.months.length).toBeLessThanOrEqual(6);
    // First-month payment should be fixed_payment_pennies
    expect(r.months[0].minimum_payments_pennies).toBe(9000);
  });
});

describe('runForecast — personal loan (installment, APR amortisation)', () => {
  test('accrues interest on outstanding principal', () => {
    const debts = [{
      id: 'zopa', subtype: DEBT_SUBTYPES.PERSONAL_LOAN, name: 'Zopa',
      balance_pennies: 450000, standard_apr: 0.089,
      fixed_payment_pennies: 18500, term_months: 36,
    }];
    const r = runForecast({ debts, buckets: [], startMonth: '2026-05-01', months: 3 });
    // Interest charged month 1 = 450000 × 0.089/12 ≈ 3337p
    expect(r.months[0].interest_pennies).toBeGreaterThan(3000);
    expect(r.months[0].interest_pennies).toBeLessThan(3500);
    expect(r.months[0].minimum_payments_pennies).toBe(18500);
  });

  test('extra budget reduces balance (accepts above-min payments)', () => {
    const debts = [{
      id: 'zopa', subtype: DEBT_SUBTYPES.PERSONAL_LOAN, name: 'Zopa',
      balance_pennies: 100000, standard_apr: 0,
      fixed_payment_pennies: 10000, term_months: 12,
    }];
    // Budget of 20000/mo = 10000 min + 10000 extra → clears in ~5 months
    const r = runForecast({ debts, buckets: [], startMonth: '2026-05-01', months: 12, monthlyBudget: 20000 });
    expect(r.debtFreeMonth).not.toBeNull();
    expect(r.months.length).toBeLessThanOrEqual(6);
  });
});

describe('runForecast — overdraft (revolving)', () => {
  test('accrues interest even with no payment', () => {
    const debts = [{
      id: 'od', subtype: DEBT_SUBTYPES.OVERDRAFT, name: 'Nationwide OD',
      balance_pennies: 50000, standard_apr: 0.399,
    }];
    const r = runForecast({ debts, buckets: [], startMonth: '2026-05-01', months: 3, monthlyBudget: 0 });
    // Balance should grow each month (interest > 0 payments)
    expect(r.months[0].ending_debt_pennies).toBeGreaterThan(50000);
  });

  test('extra budget pays it down', () => {
    const debts = [{
      id: 'od', subtype: DEBT_SUBTYPES.OVERDRAFT, name: 'Nationwide OD',
      balance_pennies: 50000, standard_apr: 0,
    }];
    const r = runForecast({ debts, buckets: [], startMonth: '2026-05-01', months: 6, monthlyBudget: 10000 });
    expect(r.debtFreeMonth).not.toBeNull();
  });
});

describe('runForecast — mixed subtypes', () => {
  test('handles all three categories in one projection', () => {
    const debts = [
      { id: 'c', subtype: DEBT_SUBTYPES.CARD, name: 'Card',
        balance_pennies: 100000, standard_apr: 0.2, min_percentage: 0.02, min_floor_pennies: 2500 },
      { id: 'bnpl', subtype: DEBT_SUBTYPES.BNPL, name: 'Klarna',
        balance_pennies: 30000, standard_apr: 0, fixed_payment_pennies: 10000, term_months: 3 },
      { id: 'od', subtype: DEBT_SUBTYPES.OVERDRAFT, name: 'OD',
        balance_pennies: 20000, standard_apr: 0.399 },
    ];
    const buckets = [
      { id: 'cb', debt_id: 'c', name: 'Purchases', balance_pennies: 100000, apr: 0.2, is_promo: false },
    ];
    const r = runForecast({ debts, buckets, startMonth: '2026-05-01', months: 24, monthlyBudget: 30000 });
    // All three should be reflected in per_debt
    expect(r.months[0].per_debt.length).toBe(3);
    // Eventually clears
    expect(r.debtFreeMonth).not.toBeNull();
  });
});

describe('runForecast — budget scaling', () => {
  test('budget < total mins → minimums scaled down proportionally', () => {
    const debts = [
      { id: 'a', subtype: DEBT_SUBTYPES.CARD, name: 'A',
        balance_pennies: 500000, standard_apr: 0, min_percentage: 0.02, min_floor_pennies: 2500 },
      { id: 'b', subtype: DEBT_SUBTYPES.CARD, name: 'B',
        balance_pennies: 500000, standard_apr: 0, min_percentage: 0.02, min_floor_pennies: 2500 },
    ];
    const buckets = [
      { id: 'ab', debt_id: 'a', name: 'p', balance_pennies: 500000, apr: 0, is_promo: false },
      { id: 'bb', debt_id: 'b', name: 'p', balance_pennies: 500000, apr: 0, is_promo: false },
    ];
    // True minimums = 10000 + 10000 = 20000; offer only 10000 — each gets scaled to 5000
    const r = runForecast({ debts, buckets, startMonth: '2026-05-01', months: 1, monthlyBudget: 10000 });
    expect(r.months[0].minimum_payments_pennies).toBeCloseTo(10000, -2);
    expect(r.months[0].extra_payments_pennies).toBe(0);
  });
});
