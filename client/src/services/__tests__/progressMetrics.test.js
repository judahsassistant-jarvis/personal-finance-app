import { describe, it, expect } from 'vitest';
import { DEBT_SUBTYPES } from '../../firebase/schema.js';
import {
  computePercentPaidOff,
  computePaymentStreak,
  computeSpendingDelta,
  computeProgressMetrics,
} from '../progressMetrics.js';

describe('computePercentPaidOff', () => {
  it('returns null when no debt has a starting balance', () => {
    const debts = [
      { id: 'a', subtype: DEBT_SUBTYPES.CARD },
      { id: 'b', subtype: DEBT_SUBTYPES.OVERDRAFT },
    ];
    expect(computePercentPaidOff(debts, [])).toBeNull();
  });

  it('aggregates across debts weighted by starting balance', () => {
    // Zopa: 25% paid (600k → 450k). Klarna: 25% paid (72k → 54k).
    // Total: (150k + 18k) / (600k + 72k) = 168k / 672k = 25%
    const debts = [
      { id: 'zopa',   subtype: DEBT_SUBTYPES.PERSONAL_LOAN, balance_pennies: 450000, starting_balance_pennies: 600000 },
      { id: 'klarna', subtype: DEBT_SUBTYPES.BNPL,          balance_pennies: 54000,  starting_balance_pennies: 72000 },
    ];
    const out = computePercentPaidOff(debts, []);
    expect(out.ratio).toBeCloseTo(0.25, 3);
    expect(out.paidPennies).toBe(168000);
    expect(out.startingPennies).toBe(672000);
  });

  it('clamps the ratio to 1.0 when the balance somehow exceeds starting', () => {
    // Can't pay off MORE than you started with, but guard against rounding.
    const debts = [{ id: 'x', subtype: DEBT_SUBTYPES.PERSONAL_LOAN, balance_pennies: -10, starting_balance_pennies: 1000 }];
    const out = computePercentPaidOff(debts, []);
    expect(out.ratio).toBeLessThanOrEqual(1);
  });

  it('ignores debts without a starting balance — only contributors count', () => {
    const debts = [
      { id: 'zopa', subtype: DEBT_SUBTYPES.PERSONAL_LOAN, balance_pennies: 450000, starting_balance_pennies: 600000 },
      { id: 'card', subtype: DEBT_SUBTYPES.CARD, balance_pennies: 0 }, // no starting
    ];
    const out = computePercentPaidOff(debts, []);
    expect(out.startingPennies).toBe(600000);
    expect(out.ratio).toBeCloseTo(0.25, 3);
  });
});

describe('computePaymentStreak', () => {
  const asOf = new Date(2026, 3, 15); // April 2026

  it('returns 0 when there are no debt-tagged payments', () => {
    expect(computePaymentStreak([], asOf)).toBe(0);
    expect(computePaymentStreak([
      { debt_id: null, date: new Date(2026, 3, 5).getTime() }, // untagged
    ], asOf)).toBe(0);
  });

  it('counts consecutive months ending at the current month', () => {
    const txs = [
      { debt_id: 'd1', date: new Date(2026, 3, 5).getTime() },  // April
      { debt_id: 'd1', date: new Date(2026, 2, 5).getTime() },  // March
      { debt_id: 'd2', date: new Date(2026, 1, 5).getTime() },  // February
    ];
    expect(computePaymentStreak(txs, asOf)).toBe(3);
  });

  it('counts the streak up to last month when current month has no payment yet', () => {
    // Today is April 15 with no April payments — Feb and March count.
    const txs = [
      { debt_id: 'd1', date: new Date(2026, 2, 5).getTime() },  // March
      { debt_id: 'd1', date: new Date(2026, 1, 5).getTime() },  // February
    ];
    expect(computePaymentStreak(txs, asOf)).toBe(2);
  });

  it('stops counting at the first missing month', () => {
    // Feb and April paid, March missed → streak of 1 (just April).
    const txs = [
      { debt_id: 'd1', date: new Date(2026, 3, 5).getTime() },  // April
      { debt_id: 'd1', date: new Date(2026, 1, 5).getTime() },  // February
    ];
    expect(computePaymentStreak(txs, asOf)).toBe(1);
  });

  it('collapses multiple payments in the same month into one streak step', () => {
    // Two payments in March shouldn't count as two months.
    const txs = [
      { debt_id: 'd1', date: new Date(2026, 2, 5).getTime() },
      { debt_id: 'd1', date: new Date(2026, 2, 25).getTime() },
    ];
    // As-of April 15, no April payment — streak counts March only.
    expect(computePaymentStreak(txs, asOf)).toBe(1);
  });

  it('ignores transactions without a debt_id', () => {
    const txs = [
      { debt_id: null, date: new Date(2026, 3, 5).getTime() },
      { debt_id: 'd1', date: new Date(2026, 2, 5).getTime() },
    ];
    expect(computePaymentStreak(txs, asOf)).toBe(1); // just March
  });
});

describe('computeSpendingDelta', () => {
  const debtId = 'd1';

  it('returns null with fewer than two snapshots', () => {
    expect(computeSpendingDelta(debtId, [], [])).toBeNull();
    expect(computeSpendingDelta(debtId, [
      { debt_id: debtId, as_of_date: 100, balance_pennies: 100000 },
    ], [])).toBeNull();
  });

  it('computes "no new charges" when balance dropped by exactly the payment', () => {
    // Previous £1,000, paid £200, current £800 → new_charges = (1000-200)-800 = 0
    const snaps = [
      { id: 's1', debt_id: debtId, as_of_date: 1000, balance_pennies: 100000 },
      { id: 's2', debt_id: debtId, as_of_date: 2000, balance_pennies: 80000 },
    ];
    const txs = [{ debt_id: debtId, date: 1500, amount_pennies: -20000 }];
    const out = computeSpendingDelta(debtId, snaps, txs);
    expect(out.newChargesPennies).toBe(0);
    expect(out.paymentsInPeriodPennies).toBe(20000);
  });

  it('computes positive new-charges when the balance barely moved despite payments', () => {
    // Paid £200, but balance only dropped £50 → £150 of new charges
    const snaps = [
      { id: 's1', debt_id: debtId, as_of_date: 1000, balance_pennies: 100000 },
      { id: 's2', debt_id: debtId, as_of_date: 2000, balance_pennies: 95000 },
    ];
    const txs = [{ debt_id: debtId, date: 1500, amount_pennies: -20000 }];
    const out = computeSpendingDelta(debtId, snaps, txs);
    expect(out.newChargesPennies).toBe(15000);
  });

  it('computes negative new-charges when the user is over-paying (refund / credit)', () => {
    // Paid £200, balance dropped by £250 → -£50 (credit / refund landed)
    const snaps = [
      { id: 's1', debt_id: debtId, as_of_date: 1000, balance_pennies: 100000 },
      { id: 's2', debt_id: debtId, as_of_date: 2000, balance_pennies: 75000 },
    ];
    const txs = [{ debt_id: debtId, date: 1500, amount_pennies: -20000 }];
    const out = computeSpendingDelta(debtId, snaps, txs);
    expect(out.newChargesPennies).toBe(-5000);
  });

  it('only counts payments in the snapshot-to-snapshot window', () => {
    const snaps = [
      { id: 's1', debt_id: debtId, as_of_date: 1000, balance_pennies: 100000 },
      { id: 's2', debt_id: debtId, as_of_date: 2000, balance_pennies: 80000 },
    ];
    const txs = [
      { debt_id: debtId, date: 500, amount_pennies: -50000 },  // before prev → ignored
      { debt_id: debtId, date: 1500, amount_pennies: -20000 }, // in period
      { debt_id: debtId, date: 2500, amount_pennies: -50000 }, // after latest → ignored
    ];
    const out = computeSpendingDelta(debtId, snaps, txs);
    expect(out.paymentsInPeriodPennies).toBe(20000);
  });

  it('ignores transactions for other debts', () => {
    // Balance dropped £200 with no in-period payments tagged to THIS debt.
    // From this debt's perspective the £200 reduction is unexplained — maybe
    // an untagged payment, maybe a refund, maybe a bank credit. The sign is
    // negative: current_balance < prev − (payments for this debt).
    const snaps = [
      { id: 's1', debt_id: debtId, as_of_date: 1000, balance_pennies: 100000 },
      { id: 's2', debt_id: debtId, as_of_date: 2000, balance_pennies: 80000 },
    ];
    const txs = [
      { debt_id: 'other', date: 1500, amount_pennies: -50000 },
    ];
    const out = computeSpendingDelta(debtId, snaps, txs);
    expect(out.paymentsInPeriodPennies).toBe(0);
    expect(out.newChargesPennies).toBe(-20000);
  });
});

describe('computeProgressMetrics', () => {
  const asOf = new Date(2026, 3, 15);
  const baseline = {
    debtFreeMonth: '2028-03-01',
    summary: { monthsToPayoff: 22, totalInterestPennies: 200000 },
  };
  const minOnly = {
    summary: { monthsToPayoff: 60, totalInterestPennies: 500000 },
  };

  it('bundles all metrics into one result', () => {
    const debts = [
      { id: 'zopa', subtype: DEBT_SUBTYPES.PERSONAL_LOAN, balance_pennies: 450000, starting_balance_pennies: 600000 },
    ];
    const out = computeProgressMetrics({
      debts, buckets: [], snapshots: [], transactions: [],
      baseline, minOnly, asOf,
    });
    expect(out.debtFreeMonth).toBe('2028-03-01');
    expect(out.monthsToPayoff).toBe(22);
    expect(out.interestSavedPennies).toBe(300000); // 500k - 200k
    expect(out.percentPaidOff.ratio).toBeCloseTo(0.25, 3);
    expect(out.paymentStreak).toBe(0);
    expect(out.spendingDeltas.size).toBe(0);
  });

  it('clamps interest saved to zero when baseline somehow costs more than min-only', () => {
    // Defensive — should never happen if forecast is sane, but the max(0,…) guard matters.
    const out = computeProgressMetrics({
      debts: [], buckets: [], snapshots: [], transactions: [],
      baseline: { summary: { totalInterestPennies: 500000, monthsToPayoff: 30 } },
      minOnly:  { summary: { totalInterestPennies: 300000, monthsToPayoff: 60 } },
      asOf,
    });
    expect(out.interestSavedPennies).toBe(0);
  });

  it('populates spendingDeltas keyed by debt_id for debts with ≥2 snapshots', () => {
    const debts = [{ id: 'zopa', subtype: DEBT_SUBTYPES.PERSONAL_LOAN, balance_pennies: 450000, starting_balance_pennies: 600000 }];
    const snapshots = [
      { id: 's1', debt_id: 'zopa', as_of_date: 1000, balance_pennies: 600000 },
      { id: 's2', debt_id: 'zopa', as_of_date: 2000, balance_pennies: 525000 },
    ];
    const out = computeProgressMetrics({
      debts, buckets: [], snapshots, transactions: [],
      baseline, minOnly, asOf,
    });
    expect(out.spendingDeltas.has('zopa')).toBe(true);
  });
});
