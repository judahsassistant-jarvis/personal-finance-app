import { describe, it, expect } from 'vitest';
import {
  getAnnualRate,
  getMonthlyRate,
  runAccountForecast,
  computeHorizonMonths,
  splitByLiquidity,
} from '../accountForecast.js';
import { ACCOUNT_SUBTYPES, LIQUIDITY } from '../../firebase/schema.js';

function account(overrides = {}) {
  return {
    id: 'a1',
    subtype: ACCOUNT_SUBTYPES.SAVINGS,
    balance_pennies: 100000,
    liquidity: LIQUIDITY.LIQUID,
    interest_rate: 0.04,
    ...overrides,
  };
}

describe('getAnnualRate', () => {
  it('returns 0 for current accounts even if interest_rate is set', () => {
    expect(getAnnualRate({ subtype: ACCOUNT_SUBTYPES.CURRENT, interest_rate: 0.05 })).toBe(0);
  });
  it('returns interest_rate for liquid savings', () => {
    expect(getAnnualRate(account({ interest_rate: 0.045 }))).toBe(0.045);
  });
  it('returns growth_rate for locked accounts', () => {
    expect(getAnnualRate(account({
      subtype: ACCOUNT_SUBTYPES.SIPP, growth_rate: 0.06, interest_rate: undefined,
    }))).toBe(0.06);
  });
  it('is 0 when no rate is set', () => {
    expect(getAnnualRate({ subtype: ACCOUNT_SUBTYPES.SAVINGS })).toBe(0);
  });
  it('handles null or malformed rates', () => {
    expect(getAnnualRate({ subtype: ACCOUNT_SUBTYPES.SAVINGS, interest_rate: null })).toBe(0);
    expect(getAnnualRate({ subtype: ACCOUNT_SUBTYPES.SAVINGS, interest_rate: 'bad' })).toBe(0);
  });
});

describe('getMonthlyRate', () => {
  it('divides annual by 12', () => {
    expect(getMonthlyRate(account({ interest_rate: 0.12 }))).toBeCloseTo(0.01, 10);
  });
});

describe('runAccountForecast', () => {
  it('emits months + 1 rows (month 0 + N projected months)', () => {
    const { rows } = runAccountForecast({ accounts: [account()], months: 12 });
    expect(rows.length).toBe(13);
    expect(rows[0].index).toBe(0);
    expect(rows[12].index).toBe(12);
  });

  it('month 0 is exactly the current balance per account', () => {
    const accounts = [
      account({ id: 'a', balance_pennies: 100000 }),
      account({ id: 'b', balance_pennies: 50000 }),
    ];
    const { rows } = runAccountForecast({ accounts, months: 6 });
    expect(rows[0].accounts.a).toBe(100000);
    expect(rows[0].accounts.b).toBe(50000);
    expect(rows[0].total_pennies).toBe(150000);
  });

  it('compounds liquid interest monthly', () => {
    // £1000 at 12% annual = 1% monthly. After 12 months: 1000 * 1.01^12 ≈ 1126.83
    const { rows } = runAccountForecast({
      accounts: [account({ balance_pennies: 100000, interest_rate: 0.12 })],
      months: 12,
    });
    const final = rows[12].accounts.a1;
    expect(final).toBeGreaterThan(112600);
    expect(final).toBeLessThan(112700);
  });

  it('adds monthly_contribution_pennies each month', () => {
    // No interest, £10k starting, £500/mo contributions × 6 months = £13k
    const { rows } = runAccountForecast({
      accounts: [account({
        balance_pennies: 1000000,
        interest_rate: 0,
        monthly_contribution_pennies: 50000,
      })],
      months: 6,
    });
    expect(rows[6].accounts.a1).toBe(1300000);
  });

  it('current accounts do not compound even with a rate on the doc', () => {
    const { rows } = runAccountForecast({
      accounts: [account({
        subtype: ACCOUNT_SUBTYPES.CURRENT, interest_rate: 0.05, balance_pennies: 100000,
      })],
      months: 12,
    });
    expect(rows[12].accounts.a1).toBe(100000);
  });

  it('aggregates total_pennies across all accounts per row', () => {
    const accounts = [
      account({ id: 'a', balance_pennies: 100000, interest_rate: 0 }),
      account({ id: 'b', balance_pennies: 200000, interest_rate: 0 }),
    ];
    const { rows } = runAccountForecast({ accounts, months: 3 });
    expect(rows[3].total_pennies).toBe(300000);
  });

  it('scenario contribution splits equally across targeted accounts', () => {
    // £1000 scenario, 2 targets → £500 each per month
    const accounts = [
      account({ id: 'a', balance_pennies: 0, interest_rate: 0 }),
      account({ id: 'b', balance_pennies: 0, interest_rate: 0 }),
      account({ id: 'c', balance_pennies: 0, interest_rate: 0 }),
    ];
    const { rows } = runAccountForecast({
      accounts, months: 4,
      scenario: { extraContributionPennies: 100000, accountIds: ['a', 'b'] },
    });
    expect(rows[4].accounts.a).toBe(200000);
    expect(rows[4].accounts.b).toBe(200000);
    expect(rows[4].accounts.c).toBe(0);
  });

  it('scenario with no accountIds leaves everything untouched', () => {
    const { rows } = runAccountForecast({
      accounts: [account({ balance_pennies: 100000, interest_rate: 0 })],
      months: 3,
      scenario: { extraContributionPennies: 100000, accountIds: [] },
    });
    expect(rows[3].accounts.a1).toBe(100000);
  });

  it('months = 0 returns only the baseline row', () => {
    const { rows } = runAccountForecast({ accounts: [account()], months: 0 });
    expect(rows.length).toBe(1);
    expect(rows[0].index).toBe(0);
  });

  it('empty accounts produces rows with zero totals', () => {
    const { rows } = runAccountForecast({ accounts: [], months: 3 });
    expect(rows.length).toBe(4);
    for (const row of rows) {
      expect(row.total_pennies).toBe(0);
      expect(row.accounts).toEqual({});
    }
  });
});

describe('computeHorizonMonths', () => {
  const now = new Date('2026-04-23');

  it('returns defaultMonths when no qualifying accounts', () => {
    expect(computeHorizonMonths({
      defaultMonths: 12, qualifyingAccounts: [], birthYear: 1982, now,
    })).toBe(12);
  });

  it('returns defaultMonths when no birthYear', () => {
    expect(computeHorizonMonths({
      defaultMonths: 12,
      qualifyingAccounts: [{ sipp_age: 58 }],
      ageField: 'sipp_age',
      birthYear: null,
      now,
    })).toBe(12);
  });

  it('extends to reach the SIPP qualifying age when both are known', () => {
    // Born 1982 → age 44 in 2026. Qualifying age 58 → 14 years → 168 months.
    expect(computeHorizonMonths({
      defaultMonths: 12,
      qualifyingAccounts: [{ sipp_age: 58 }],
      ageField: 'sipp_age',
      birthYear: 1982,
      now,
    })).toBe(14 * 12);
  });

  it('extends to reach a pension qualifying age via ageField', () => {
    // Born 1982 → age 44 in 2026. Pension age 67 → 23 years → 276 months.
    expect(computeHorizonMonths({
      defaultMonths: 12,
      qualifyingAccounts: [{ pension_age: 67 }],
      ageField: 'pension_age',
      birthYear: 1982,
      now,
    })).toBe(23 * 12);
  });

  it('uses the max qualifying age when multiple accounts differ', () => {
    expect(computeHorizonMonths({
      defaultMonths: 12,
      qualifyingAccounts: [{ sipp_age: 55 }, { sipp_age: 60 }],
      ageField: 'sipp_age',
      birthYear: 1982,
      now,
    })).toBe((60 - 44) * 12);
  });

  it('falls back to defaultAge when an account has no age set', () => {
    expect(computeHorizonMonths({
      defaultMonths: 12,
      qualifyingAccounts: [{}],
      ageField: 'pension_age',
      defaultAge: 65,
      birthYear: 1982,
      now,
    })).toBe((65 - 44) * 12);
  });

  it('never goes below defaultMonths', () => {
    expect(computeHorizonMonths({
      defaultMonths: 12,
      qualifyingAccounts: [{ sipp_age: 40 }],
      ageField: 'sipp_age',
      birthYear: 1982,
      now,
    })).toBe(12);
  });
});

describe('splitByLiquidity', () => {
  it('splits a row by liquidity tag', () => {
    const accounts = [
      { id: 'a', liquidity: LIQUIDITY.LIQUID },
      { id: 'b', liquidity: LIQUIDITY.LIQUID },
      { id: 'c', liquidity: LIQUIDITY.LOCKED },
    ];
    const row = { accounts: { a: 1000, b: 2000, c: 5000 } };
    expect(splitByLiquidity(row, accounts)).toEqual({ liquid: 3000, locked: 5000, total: 8000 });
  });

  it('ignores balances for accounts not present in the account list', () => {
    const row = { accounts: { a: 100, ghost: 999 } };
    expect(splitByLiquidity(row, [{ id: 'a', liquidity: LIQUIDITY.LIQUID }]))
      .toEqual({ liquid: 100, locked: 0, total: 100 });
  });
});
