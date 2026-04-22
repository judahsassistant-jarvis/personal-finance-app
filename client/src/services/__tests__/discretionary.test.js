import { describe, test, expect } from 'vitest';
import { computeDiscretionary } from '../discretionary.js';

const cache = {
  'england-and-wales': {
    events: [
      { date: '2026-04-03', title: 'Good Friday' },
      { date: '2026-04-06', title: 'Easter Monday' },
    ],
  },
};

const cycle = {
  cadence: 'monthly',
  day_of_month: 28,
  shift_rule: 'preceding_weekday',
  honour_bank_holidays: true,
};

describe('computeDiscretionary — baseline', () => {
  test('no accounts, no bills, no debts → everything zero', () => {
    const out = computeDiscretionary({ payCycle: cycle, asOf: new Date(2026, 3, 10) });
    expect(out.liquid_pennies).toBe(0);
    expect(out.safe_to_spend_pennies).toBe(0);
    expect(out.discretionary_pennies).toBe(0);
  });

  test('only opted-in accounts contribute to safe_to_spend', () => {
    const accounts = [
      { include_in_safe_to_spend: true, balance_pennies: 100000 },
      { include_in_safe_to_spend: true, balance_pennies: 50000 },
      // Big savings balance that should NOT silently inflate the budget
      { include_in_safe_to_spend: false, balance_pennies: 9_000_000 },
    ];
    const out = computeDiscretionary({ accounts, payCycle: cycle, asOf: new Date(2026, 3, 10) });
    expect(out.liquid_pennies).toBe(150000);
    expect(out.safe_to_spend_pennies).toBe(150000);
  });

  test('account missing include_in_safe_to_spend is treated as excluded', () => {
    // Defensive: Firestore docs pre-dating the field default to excluded, not included.
    const accounts = [
      { balance_pennies: 100000 },            // no field
      { include_in_safe_to_spend: false, balance_pennies: 200000 },
      { include_in_safe_to_spend: true, balance_pennies: 50000 },
    ];
    const out = computeDiscretionary({ accounts, payCycle: cycle, asOf: new Date(2026, 3, 10) });
    expect(out.liquid_pennies).toBe(50000);
  });
});

describe('computeDiscretionary — bills subtract', () => {
  test('upcoming + missed bills reduce safe-to-spend', () => {
    const accounts = [{ include_in_safe_to_spend: true, balance_pennies: 200000 }];
    const bills = [
      { merchant: 'Netflix', expected_amount_pennies: 1399, expected_day_of_month: 5 },  // missed
      { merchant: 'Spotify', expected_amount_pennies: 999, expected_day_of_month: 18 }, // upcoming
      { merchant: 'Octopus', expected_amount_pennies: 12500, expected_day_of_month: 1 }, // paid (see tx)
    ];
    const transactions = [{ merchant: 'Octopus', amount_pennies: -12500, date: '2026-04-01' }];
    const out = computeDiscretionary({
      accounts, bills, transactions, payCycle: cycle, holidayCache: cache, asOf: new Date(2026, 3, 10),
    });
    expect(out.bills.pending_count).toBe(1);
    expect(out.bills.missed_count).toBe(1);
    expect(out.bills.total_remaining_pennies).toBe(999 + 1399);
    expect(out.safe_to_spend_pennies).toBe(200000 - (999 + 1399));
  });
});

describe('computeDiscretionary — debt minimums', () => {
  test('card debts with min_floor contribute to pending minimums', () => {
    const accounts = [{ include_in_safe_to_spend: true, balance_pennies: 1_000_000 }];
    const debts = [
      {
        id: 'd1', subtype: 'card', balance_pennies: 500000,
        min_percentage: 0.02, min_floor_pennies: 2500,
      },
      {
        id: 'd2', subtype: 'personal_loan', balance_pennies: 400000,
        fixed_payment_pennies: 15000,
      },
    ];
    const out = computeDiscretionary({
      accounts, debts, payCycle: cycle, holidayCache: cache, asOf: new Date(2026, 3, 10),
    });
    // d1 min = max(500000*0.02, 2500) = 10000
    // d2 min = 15000
    expect(out.debt_minimums.pending_pennies).toBe(10000 + 15000);
    expect(out.safe_to_spend_pennies).toBe(1_000_000 - 25000);
  });

  test('a debt payment transaction marks the minimum as paid', () => {
    const accounts = [{ include_in_safe_to_spend: true, balance_pennies: 1_000_000 }];
    const debts = [{
      id: 'd1', subtype: 'card', balance_pennies: 500000,
      min_percentage: 0.02, min_floor_pennies: 2500,
    }];
    const transactions = [
      { debt_id: 'd1', category: 'Debt Payment', amount_pennies: -10000, date: '2026-04-05' },
    ];
    const out = computeDiscretionary({
      accounts, debts, transactions, payCycle: cycle, holidayCache: cache, asOf: new Date(2026, 3, 10),
    });
    expect(out.debt_minimums.paid_count).toBe(1);
    expect(out.debt_minimums.pending_pennies).toBe(0);
  });

  test('overdraft does not contribute a required minimum', () => {
    const accounts = [{ include_in_safe_to_spend: true, balance_pennies: 100000 }];
    const debts = [{ id: 'd1', subtype: 'overdraft', balance_pennies: 50000 }];
    const out = computeDiscretionary({
      accounts, debts, payCycle: cycle, holidayCache: cache, asOf: new Date(2026, 3, 10),
    });
    expect(out.debt_minimums.pending_pennies).toBe(0);
  });
});

describe('computeDiscretionary — buffer', () => {
  test('buffer subtracts from safe_to_spend to yield discretionary', () => {
    const accounts = [{ include_in_safe_to_spend: true, balance_pennies: 100000 }];
    const out = computeDiscretionary({
      accounts, payCycle: cycle, holidayCache: cache, bufferPennies: 20000, asOf: new Date(2026, 3, 10),
    });
    expect(out.safe_to_spend_pennies).toBe(100000);
    expect(out.discretionary_pennies).toBe(80000);
  });
});

describe('computeDiscretionary — expected income', () => {
  test('future-dated inflow within cycle adds to safe_to_spend', () => {
    const accounts = [{ include_in_safe_to_spend: true, balance_pennies: 100000 }];
    const transactions = [
      { merchant: 'Employer', category: 'Income', amount_pennies: 380000, date: '2026-04-27' },
    ];
    const out = computeDiscretionary({
      accounts, transactions, payCycle: cycle, holidayCache: cache, asOf: new Date(2026, 3, 10),
    });
    // Pay day April 28 (Tue, weekday). So a salary on April 27 is before pay day → counts.
    expect(out.expected_income_pennies).toBe(380000);
    expect(out.safe_to_spend_pennies).toBe(100000 + 380000);
  });

  test('past-dated inflow does not count (already reflected in balance)', () => {
    const accounts = [{ include_in_safe_to_spend: true, balance_pennies: 100000 }];
    const transactions = [
      { merchant: 'Employer', category: 'Income', amount_pennies: 380000, date: '2026-04-01' },
    ];
    const out = computeDiscretionary({
      accounts, transactions, payCycle: cycle, holidayCache: cache, asOf: new Date(2026, 3, 10),
    });
    expect(out.expected_income_pennies).toBe(0);
  });
});

describe('computeDiscretionary — expected income scoped to safe-to-spend accounts', () => {
  test('income landing in an excluded account does not count as phantom money', () => {
    const accounts = [
      { id: 'current', include_in_safe_to_spend: true, balance_pennies: 100000 },
      { id: 'savings', include_in_safe_to_spend: false, balance_pennies: 9_000_000 },
    ];
    const transactions = [
      { account_id: 'savings', merchant: 'Bank Interest', amount_pennies: 380000, date: '2026-04-27' },
    ];
    const out = computeDiscretionary({
      accounts, transactions, payCycle: cycle, holidayCache: cache, asOf: new Date(2026, 3, 10),
    });
    expect(out.expected_income_pennies).toBe(0);
    expect(out.safe_to_spend_pennies).toBe(100000);
  });

  test('income landing in a safe-to-spend account still counts', () => {
    const accounts = [
      { id: 'current', include_in_safe_to_spend: true, balance_pennies: 100000 },
      { id: 'savings', include_in_safe_to_spend: false, balance_pennies: 9_000_000 },
    ];
    const transactions = [
      { account_id: 'current', merchant: 'Employer', amount_pennies: 380000, date: '2026-04-27' },
    ];
    const out = computeDiscretionary({
      accounts, transactions, payCycle: cycle, holidayCache: cache, asOf: new Date(2026, 3, 10),
    });
    expect(out.expected_income_pennies).toBe(380000);
  });
});

describe('computeDiscretionary — throws without payCycle', () => {
  test('missing payCycle → throws', () => {
    expect(() => computeDiscretionary({ accounts: [] })).toThrow(/payCycle/);
  });
});
