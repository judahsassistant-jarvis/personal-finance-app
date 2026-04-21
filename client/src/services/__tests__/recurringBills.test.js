import { describe, test, expect } from 'vitest';
import { inferRecurringBills, billStatusInCycle, remainingBillsInCycle } from '../recurringBills.js';

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
