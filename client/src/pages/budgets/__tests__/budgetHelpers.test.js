import { describe, test, expect } from 'vitest';
import {
  computeSpendByCategory,
  buildBudgetRows,
  computeBudgetTotals,
  currentMonthKey,
  shiftMonth,
  formatMonthHeader,
  EXCLUDE_FROM_BUDGETS,
} from '../budgetHelpers.js';

function tx(date, category, pounds) {
  return { date, category, amount_pennies: Math.round(pounds * 100) };
}

describe('computeSpendByCategory', () => {
  test('sums outflow magnitudes per category for the target month', () => {
    const txs = [
      tx('2026-04-01', 'Food', -25),
      tx('2026-04-15', 'Food', -30),
      tx('2026-04-20', 'Bills', -100),
      tx('2026-04-30', 'Shopping', -50),
    ];
    const result = computeSpendByCategory(txs, '2026-04');
    expect(result.get('Food')).toBe(5500);
    expect(result.get('Bills')).toBe(10000);
    expect(result.get('Shopping')).toBe(5000);
  });

  test('ignores transactions outside the target month', () => {
    const txs = [
      tx('2026-03-31', 'Food', -25),
      tx('2026-04-15', 'Food', -30),
      tx('2026-05-01', 'Food', -40),
    ];
    expect(computeSpendByCategory(txs, '2026-04').get('Food')).toBe(3000);
  });

  test('ignores inflows', () => {
    const txs = [
      tx('2026-04-15', 'Income', 2000),
      tx('2026-04-20', 'Food', 50), // refund counts as inflow
    ];
    const result = computeSpendByCategory(txs, '2026-04');
    expect(result.has('Income')).toBe(false);
    expect(result.has('Food')).toBe(false);
  });

  test('excludes balance-shifting categories (Transfer / Investment / Payments / Debt Payment)', () => {
    const txs = [
      tx('2026-04-09', 'Investment', -3200),
      tx('2026-04-15', 'Transfer', -200),
      tx('2026-04-20', 'Debt Payment', -300),
      tx('2026-04-25', 'Payments', -150),
      tx('2026-04-26', 'Food', -50),
    ];
    const result = computeSpendByCategory(txs, '2026-04');
    expect(result.has('Investment')).toBe(false);
    expect(result.has('Transfer')).toBe(false);
    expect(result.has('Debt Payment')).toBe(false);
    expect(result.has('Payments')).toBe(false);
    expect(result.get('Food')).toBe(5000);
  });

  test('returns empty map for invalid targetMonth', () => {
    expect(computeSpendByCategory([], 'not-a-month').size).toBe(0);
    expect(computeSpendByCategory([], null).size).toBe(0);
  });

  test('handles Firestore Timestamp-shaped dates', () => {
    const epoch = (iso) => Math.floor(new Date(iso).getTime() / 1000);
    const txs = [
      { date: { seconds: epoch('2026-04-15') }, category: 'Food', amount_pennies: -2500 },
    ];
    expect(computeSpendByCategory(txs, '2026-04').get('Food')).toBe(2500);
  });
});

describe('buildBudgetRows', () => {
  const baseAvailable = ['Bills', 'Food', 'Shopping', 'Subscriptions', 'Other'];

  test('one row per category, populated with spend / budget / suggestion', () => {
    const rows = buildBudgetRows({
      spendByCategory: new Map([['Food', 8000], ['Bills', 12000]]),
      budgets: [
        { id: 'b1', category: 'Food', amount_pennies: 10000 },
      ],
      suggestions: [
        { category: 'Bills', suggested_amount_pennies: 13000, confidence: 'high' },
        { category: 'Subscriptions', suggested_amount_pennies: 4000, confidence: 'medium' },
      ],
      availableCategories: baseAvailable,
    });
    const food = rows.find((r) => r.category === 'Food');
    expect(food.spent_pennies).toBe(8000);
    expect(food.budget_pennies).toBe(10000);
    expect(food.budget_id).toBe('b1');
    expect(food.remaining_pennies).toBe(2000);
    expect(food.utilisation).toBeCloseTo(0.8);
    expect(food.suggestion_pennies).toBeNull();

    const bills = rows.find((r) => r.category === 'Bills');
    expect(bills.spent_pennies).toBe(12000);
    expect(bills.budget_pennies).toBeNull();
    expect(bills.suggestion_pennies).toBe(13000);
    expect(bills.suggestion_confidence).toBe('high');

    const subs = rows.find((r) => r.category === 'Subscriptions');
    expect(subs.spent_pennies).toBe(0);
    expect(subs.suggestion_pennies).toBe(4000);
  });

  test('excludes balance-shifting categories even if a budget or suggestion mentions them', () => {
    const rows = buildBudgetRows({
      spendByCategory: new Map(),
      budgets: [
        { id: 'b1', category: 'Transfer', amount_pennies: 0 },
      ],
      suggestions: [
        { category: 'Investment', suggested_amount_pennies: 100 },
      ],
      availableCategories: ['Transfer', 'Investment', 'Food'],
    });
    expect(rows.find((r) => r.category === 'Transfer')).toBeUndefined();
    expect(rows.find((r) => r.category === 'Investment')).toBeUndefined();
    expect(rows.find((r) => r.category === 'Food')).toBeDefined();
  });

  test('rows sorted by spend desc, then category name', () => {
    const rows = buildBudgetRows({
      spendByCategory: new Map([
        ['Bills', 12000], ['Shopping', 5000], ['Food', 12000], ['Other', 0],
      ]),
      budgets: [],
      suggestions: [],
      availableCategories: [],
    });
    expect(rows.map((r) => r.category)).toEqual(['Bills', 'Food', 'Shopping', 'Other']);
  });

  test('utilisation is null when no budget set', () => {
    const rows = buildBudgetRows({
      spendByCategory: new Map([['Food', 5000]]),
      budgets: [],
      suggestions: [],
      availableCategories: ['Food'],
    });
    expect(rows[0].utilisation).toBeNull();
    expect(rows[0].remaining_pennies).toBeNull();
  });
});

describe('computeBudgetTotals', () => {
  test('aggregates spend / budget / counts', () => {
    const rows = [
      { category: 'Food', spent_pennies: 8000, budget_pennies: 10000 },
      { category: 'Bills', spent_pennies: 12000, budget_pennies: 13000 },
      { category: 'Shopping', spent_pennies: 0, budget_pennies: null },
    ];
    expect(computeBudgetTotals(rows)).toEqual({
      total_spent_pennies: 20000,
      total_budget_pennies: 23000,
      total_remaining_pennies: 3000,
      budgeted_category_count: 2,
      total_category_count: 3,
    });
  });
});

describe('currentMonthKey', () => {
  test('formats a Date as YYYY-MM', () => {
    expect(currentMonthKey(new Date(2026, 3, 15))).toBe('2026-04');
    expect(currentMonthKey(new Date(2026, 0, 1))).toBe('2026-01');
    expect(currentMonthKey(new Date(2026, 11, 31))).toBe('2026-12');
  });
});

describe('shiftMonth', () => {
  test('moves forward / back by N months', () => {
    expect(shiftMonth('2026-04', 1)).toBe('2026-05');
    expect(shiftMonth('2026-04', -1)).toBe('2026-03');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});

describe('formatMonthHeader', () => {
  test('renders as full month name + year', () => {
    expect(formatMonthHeader('2026-04')).toBe('April 2026');
    expect(formatMonthHeader('2026-12')).toBe('December 2026');
  });
});

describe('EXCLUDE_FROM_BUDGETS', () => {
  test('matches the suggestion engine exclusions', () => {
    expect(EXCLUDE_FROM_BUDGETS.has('Transfer')).toBe(true);
    expect(EXCLUDE_FROM_BUDGETS.has('Investment')).toBe(true);
    expect(EXCLUDE_FROM_BUDGETS.has('Payments')).toBe(true);
    expect(EXCLUDE_FROM_BUDGETS.has('Debt Payment')).toBe(true);
    expect(EXCLUDE_FROM_BUDGETS.has('Income')).toBe(true);
    expect(EXCLUDE_FROM_BUDGETS.has('Food')).toBe(false);
  });
});
