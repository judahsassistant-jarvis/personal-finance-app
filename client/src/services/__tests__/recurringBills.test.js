import { describe, test, expect } from 'vitest';
import { inferRecurringBills, billStatusInCycle, remainingBillsInCycle, findMatchingRecurringBill } from '../recurringBills.js';

function tx(date, merchant, pounds, category = 'Bills') {
  return { date, merchant, amount_pennies: Math.round(pounds * 100), category };
}

describe('inferRecurringBills', () => {
  test('returns [] for empty input', () => {
    expect(inferRecurringBills({ transactions: [] })).toEqual([]);
  });

  test('single-occurrence merchants are not inferred as recurring', () => {
    const transactions = [tx('2026-03-01', 'Netflix', -13.99)];
    expect(inferRecurringBills({ transactions, asOf: new Date(2026, 3, 15) })).toEqual([]);
  });

  test('detects monthly bill with matching amount', () => {
    const transactions = [
      tx('2026-01-05', 'Netflix', -13.99),
      tx('2026-02-05', 'Netflix', -13.99),
      tx('2026-03-05', 'Netflix', -13.99),
    ];
    const asOf = new Date(2026, 3, 15);
    const out = inferRecurringBills({ transactions, asOf, lookbackMonths: 6 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      merchant: 'Netflix',
      expected_amount_pennies: 1399,
      expected_day_of_month: 5,
      occurrences: 3,
      auto_inferred: true,
    });
  });

  test('tolerates ±5% amount variance', () => {
    const transactions = [
      tx('2026-01-01', 'Octopus Energy', -120),
      tx('2026-02-01', 'Octopus Energy', -122), // +1.6%
      tx('2026-03-01', 'Octopus Energy', -125), // +4.1%
    ];
    const out = inferRecurringBills({ transactions, asOf: new Date(2026, 3, 15), lookbackMonths: 6 });
    expect(out).toHaveLength(1);
  });

  test('loose tier (±25%) catches variable bills with 3+ occurrences', () => {
    // Energy bill: £140 winter / £80 summer / £110 spring. Spread is ±27%
    // from £110 mean — too wide for the tight tier but the loose tier
    // (±25%, 3+ occurrences) should catch it. Median £110.
    const transactions = [
      tx('2026-01-01', 'EDF Energy', -140),
      tx('2026-02-01', 'EDF Energy', -110),
      tx('2026-03-01', 'EDF Energy', -88),
    ];
    const out = inferRecurringBills({ transactions, asOf: new Date(2026, 3, 15), lookbackMonths: 6 });
    expect(out).toHaveLength(1);
    expect(out[0].merchant).toBe('EDF Energy');
    expect(out[0].expected_amount_pennies).toBe(11000); // median
    expect(out[0].occurrences).toBe(3);
  });

  test('loose tier rejects 2-occurrence variable patterns', () => {
    // Two-occurrence variable bill with > 5% spread: tight tier requires 5%
    // and finds nothing; loose tier requires 3+ and also rejects.
    const transactions = [
      tx('2026-02-01', 'EDF Energy', -140),
      tx('2026-03-01', 'EDF Energy', -88),
    ];
    expect(inferRecurringBills({ transactions, asOf: new Date(2026, 3, 15), lookbackMonths: 6 })).toEqual([]);
  });

  test('uses median (not first-seen) as the expected amount', () => {
    // Three same-merchant rows, tight cluster around £100. The first-seen
    // happens to be the outlier £95 but the median £100 should win.
    const transactions = [
      tx('2026-01-01', 'Spotify', -95),
      tx('2026-02-01', 'Spotify', -100),
      tx('2026-03-01', 'Spotify', -100),
    ];
    const out = inferRecurringBills({ transactions, asOf: new Date(2026, 3, 15), lookbackMonths: 6 });
    expect(out).toHaveLength(1);
    expect(out[0].expected_amount_pennies).toBe(10000);
  });

  test('ignores inflows (positive amounts)', () => {
    const transactions = [
      tx('2026-02-01', 'Employer', 3800),
      tx('2026-03-01', 'Employer', 3800),
    ];
    expect(inferRecurringBills({ transactions, asOf: new Date(2026, 3, 15), lookbackMonths: 6 })).toEqual([]);
  });

  test('next_expected rolls forward to next month when expected day has passed', () => {
    const transactions = [
      tx('2026-01-05', 'Netflix', -13.99),
      tx('2026-02-05', 'Netflix', -13.99),
    ];
    const asOf = new Date(2026, 3, 10); // April 10 — past day-5
    const [bill] = inferRecurringBills({ transactions, asOf, lookbackMonths: 6 });
    expect(bill.next_expected.getMonth()).toBe(4); // May
    expect(bill.next_expected.getDate()).toBe(5);
  });

  test('multiple merchants produce sorted list by expected day', () => {
    const transactions = [
      tx('2026-02-20', 'Late Bill', -50),
      tx('2026-03-20', 'Late Bill', -50),
      tx('2026-02-05', 'Early Bill', -10),
      tx('2026-03-05', 'Early Bill', -10),
    ];
    const out = inferRecurringBills({ transactions, asOf: new Date(2026, 3, 1), lookbackMonths: 6 });
    expect(out.map((b) => b.merchant)).toEqual(['Early Bill', 'Late Bill']);
  });

  test('excludes Transfer / Investment / Payments / Debt Payment categories', () => {
    // A monthly £500 contribution to JPMorgan Chase shouldn't get picked up
    // as a "recurring bill" — it's a balance transfer, already reflected in
    // the destination account's balance. Same for any Transfer-tagged row.
    const transactions = [
      tx('2026-01-09', 'JPMorgan Chase', -500, 'Investment'),
      tx('2026-02-09', 'JPMorgan Chase', -500, 'Investment'),
      tx('2026-03-09', 'JPMorgan Chase', -500, 'Investment'),
      tx('2026-01-15', 'Payment from Yehuda Levi', -200, 'Transfer'),
      tx('2026-02-15', 'Payment from Yehuda Levi', -200, 'Transfer'),
      tx('2026-03-15', 'Payment from Yehuda Levi', -200, 'Transfer'),
      tx('2026-01-05', 'Netflix', -13.99),
      tx('2026-02-05', 'Netflix', -13.99),
      tx('2026-03-05', 'Netflix', -13.99),
    ];
    const out = inferRecurringBills({ transactions, asOf: new Date(2026, 3, 15), lookbackMonths: 6 });
    const merchants = out.map((b) => b.merchant);
    expect(merchants).toContain('Netflix');
    expect(merchants).not.toContain('JPMorgan Chase');
    expect(merchants).not.toContain('Payment from Yehuda Levi');
  });

  test('excludes transactions tagged with debt_id (§3.7 single-source rule)', () => {
    // A debt payment like BARCLAYCARD BP appears every month with the same
    // amount — the old inference would pick it up as a "bill", which would
    // then double-count in safe-to-spend alongside the debt minimum. Once
    // the user tags it with debt_id, the inference must stop surfacing it.
    const transactions = [
      { ...tx('2026-01-05', 'BARCLAYCARD BP', -80), debt_id: 'd1' },
      { ...tx('2026-02-05', 'BARCLAYCARD BP', -80), debt_id: 'd1' },
      { ...tx('2026-03-05', 'BARCLAYCARD BP', -80), debt_id: 'd1' },
      tx('2026-01-05', 'Netflix', -13.99),
      tx('2026-02-05', 'Netflix', -13.99),
      tx('2026-03-05', 'Netflix', -13.99),
    ];
    const out = inferRecurringBills({ transactions, asOf: new Date(2026, 3, 15), lookbackMonths: 6 });
    const merchants = out.map((b) => b.merchant);
    expect(merchants).toContain('Netflix');
    expect(merchants).not.toContain('BARCLAYCARD BP');
  });
});

describe('findMatchingRecurringBill', () => {
  test('exact case-insensitive merchant match returns the bill', () => {
    const bills = [
      { id: 'b1', merchant: 'BARCLAYCARD BP', category: 'Bills' },
      { id: 'b2', merchant: 'Netflix', category: 'Entertainment' },
    ];
    expect(findMatchingRecurringBill('barclaycard bp', bills).id).toBe('b1');
    expect(findMatchingRecurringBill('NETFLIX', bills).id).toBe('b2');
  });

  test('returns null when no bill matches', () => {
    const bills = [{ id: 'b1', merchant: 'Spotify' }];
    expect(findMatchingRecurringBill('Tesco', bills)).toBeNull();
  });

  test('returns null for empty / null inputs', () => {
    expect(findMatchingRecurringBill('', [{ id: 'b', merchant: 'X' }])).toBeNull();
    expect(findMatchingRecurringBill(null, [])).toBeNull();
    expect(findMatchingRecurringBill('X', null)).toBeNull();
  });

  test('requires exact merchant match (no partial / fuzzy)', () => {
    // By design: we don't want to accidentally delete the user's Netflix
    // bill when they tag a "NETFLIX REFUND" transaction. Tag + cascade is
    // deliberately conservative.
    const bills = [{ id: 'b1', merchant: 'Netflix' }];
    expect(findMatchingRecurringBill('Netflix Gift Card', bills)).toBeNull();
  });
});

describe('billStatusInCycle', () => {
  const cycleStart = new Date(2026, 2, 27);   // 27 Mar
  const cycleEnd = new Date(2026, 3, 28);     // 28 Apr

  test('paid — tx matches merchant + amount + in window', () => {
    const bill = { merchant: 'Netflix', expected_amount_pennies: 1399, expected_day_of_month: 5 };
    const transactions = [tx('2026-04-05', 'Netflix', -13.99)];
    expect(billStatusInCycle({ bill, transactions, cycleStart, cycleEnd })).toBe('paid');
  });

  test('upcoming — expected date not yet reached this cycle', () => {
    const bill = { merchant: 'Netflix', expected_amount_pennies: 1399, expected_day_of_month: 22 };
    const now = new Date(2026, 3, 10);
    expect(billStatusInCycle({ bill, transactions: [], cycleStart, cycleEnd, now })).toBe('upcoming');
  });

  test('missed — expected date passed, no matching tx', () => {
    const bill = { merchant: 'Netflix', expected_amount_pennies: 1399, expected_day_of_month: 5 };
    const now = new Date(2026, 3, 15);
    expect(billStatusInCycle({ bill, transactions: [], cycleStart, cycleEnd, now })).toBe('missed');
  });

  test('amount outside tolerance → not paid', () => {
    const bill = { merchant: 'Netflix', expected_amount_pennies: 1399, expected_day_of_month: 5 };
    const now = new Date(2026, 3, 10);
    const transactions = [tx('2026-04-05', 'Netflix', -20.00)]; // way off
    expect(billStatusInCycle({ bill, transactions, cycleStart, cycleEnd, now })).not.toBe('paid');
  });
});

describe('remainingBillsInCycle', () => {
  const cycleStart = new Date(2026, 2, 27);
  const cycleEnd = new Date(2026, 3, 28);

  test('aggregates pending + missed counts + amounts', () => {
    const bills = [
      { merchant: 'Netflix', expected_amount_pennies: 1399, expected_day_of_month: 5 },      // missed (no tx)
      { merchant: 'Spotify', expected_amount_pennies: 999,  expected_day_of_month: 18 },     // upcoming
      { merchant: 'Octopus', expected_amount_pennies: 12500, expected_day_of_month: 1 },     // paid
    ];
    const transactions = [tx('2026-04-01', 'Octopus', -125)];
    const now = new Date(2026, 3, 10);
    const out = remainingBillsInCycle({ bills, transactions, cycleStart, cycleEnd, now });
    expect(out.pending_count).toBe(1);
    expect(out.missed_count).toBe(1);
    expect(out.pending_pennies).toBe(999);
    expect(out.missed_pennies).toBe(1399);
    expect(out.total_remaining_pennies).toBe(999 + 1399);
  });
});
