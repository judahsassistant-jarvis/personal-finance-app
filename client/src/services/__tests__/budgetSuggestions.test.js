import { describe, test, expect } from 'vitest';
import { generateSuggestions } from '../budgetSuggestions.js';

function tx(date, category, pounds) {
  return { date, category, amount_pennies: Math.round(pounds * 100) };
}

describe('generateSuggestions — empty', () => {
  test('no transactions → empty suggestions', () => {
    const r = generateSuggestions({ transactions: [], targetMonth: '2026-05' });
    expect(r.suggestions).toEqual([]);
    expect(r.analysis.transactionCount).toBe(0);
  });
});

describe('generateSuggestions — basic', () => {
  test('single category with consistent 3-month spending → high confidence', () => {
    const transactions = [
      tx('2026-02-05', 'Groceries', -80),
      tx('2026-02-20', 'Groceries', -60),
      tx('2026-03-04', 'Groceries', -90),
      tx('2026-03-18', 'Groceries', -70),
      tx('2026-04-06', 'Groceries', -75),
      tx('2026-04-22', 'Groceries', -65),
    ];
    const r = generateSuggestions({ transactions, targetMonth: '2026-05' });
    expect(r.suggestions).toHaveLength(1);
    const sug = r.suggestions[0];
    expect(sug.category).toBe('Groceries');
    expect(sug.confidence).toBe('high');
    // Total £440 over 3 months → avg £146.67 → + 10% → £161.34 → ceil pennies = 16134
    expect(sug.suggested_amount_pennies).toBe(16134);
  });

  test('sparse spending gets lower confidence', () => {
    const transactions = [
      tx('2026-02-05', 'Shopping', -50),
      tx('2026-04-20', 'Shopping', -40), // only 2 months of 3
    ];
    const r = generateSuggestions({ transactions, targetMonth: '2026-05' });
    const sug = r.suggestions[0];
    expect(sug.confidence).not.toBe('high'); // count < 3
  });
});

describe('generateSuggestions — exclusions', () => {
  test('excludes Payments / Transfer / Debt Payment / Income', () => {
    const transactions = [
      tx('2026-02-05', 'Payments', -500),
      tx('2026-03-05', 'Transfer', -200),
      tx('2026-04-05', 'Debt Payment', -300),
      tx('2026-04-15', 'Income', 2000),
      tx('2026-04-16', 'Groceries', -50),
    ];
    const r = generateSuggestions({ transactions, targetMonth: '2026-05' });
    expect(r.suggestions.map((s) => s.category)).toEqual(['Groceries']);
  });
});

describe('generateSuggestions — existing budgets', () => {
  test('marks already_budgeted and includes current_allocation_pennies', () => {
    const transactions = [
      tx('2026-03-01', 'Groceries', -100),
      tx('2026-03-20', 'Groceries', -120),
      tx('2026-04-01', 'Groceries', -110),
    ];
    const existingBudgets = [{ category: 'Groceries', amount_pennies: 12000 }];
    const r = generateSuggestions({ transactions, targetMonth: '2026-05', existingBudgets });
    const sug = r.suggestions.find((s) => s.category === 'Groceries');
    expect(sug.already_budgeted).toBe(true);
    expect(sug.current_allocation_pennies).toBe(12000);
  });
});

describe('generateSuggestions — sorted by suggested amount', () => {
  test('returned suggestions sorted desc by suggested_amount_pennies', () => {
    const transactions = [
      tx('2026-04-01', 'Shopping', -200),
      tx('2026-04-02', 'Groceries', -50),
      tx('2026-04-03', 'Transport', -30),
    ];
    const r = generateSuggestions({ transactions, targetMonth: '2026-05' });
    const amounts = r.suggestions.map((s) => s.suggested_amount_pennies);
    for (let i = 0; i < amounts.length - 1; i++) {
      expect(amounts[i]).toBeGreaterThanOrEqual(amounts[i + 1]);
    }
  });
});

describe('generateSuggestions — ignores positive-amount inflows', () => {
  test('positive amount_pennies (inflows) excluded even outside Income category', () => {
    const transactions = [
      tx('2026-04-01', 'Groceries', 100), // positive → ignored
      tx('2026-04-02', 'Groceries', -50), // outflow → counted
    ];
    const r = generateSuggestions({ transactions, targetMonth: '2026-05' });
    // Only the £50 outflow considered; only April has activity → monthsAnalyzed = 1
    // £50 / 1 × 1.1 = £55.00 → 5500 pennies
    expect(r.suggestions[0].suggested_amount_pennies).toBe(5500);
  });
});
