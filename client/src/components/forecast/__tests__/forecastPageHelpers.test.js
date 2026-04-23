import { describe, it, expect } from 'vitest';
import {
  toAccountChartData,
  accountSeriesSpecs,
  getCurrentAge,
  LINE_COLORS,
} from '../forecastPageHelpers.js';
import { LIQUIDITY } from '../../../firebase/schema.js';

function row(index, date, accountBalances) {
  return { index, date, accounts: accountBalances, total_pennies: Object.values(accountBalances).reduce((a, b) => a + b, 0) };
}

describe('toAccountChartData', () => {
  const accounts = [
    { id: 'a', name: 'Current', liquidity: LIQUIDITY.LIQUID },
    { id: 'b', name: 'Savings', liquidity: LIQUIDITY.LIQUID },
    { id: 'c', name: 'SIPP', liquidity: LIQUIDITY.LOCKED },
  ];
  const rows = [
    row(0, new Date('2026-04-01'), { a: 100000, b: 500000, c: 2000000 }),
    row(1, new Date('2026-05-01'), { a: 100000, b: 501500, c: 2008333 }),
  ];

  it('emits one row per input row with per-account pounds + totals', () => {
    const out = toAccountChartData(rows, accounts, ['a', 'b', 'c']);
    expect(out).toHaveLength(2);
    expect(out[0].Current).toBe(1000);
    expect(out[0].Savings).toBe(5000);
    expect(out[0].SIPP).toBe(20000);
    expect(out[0].total).toBe(26000);
  });

  it('only emits columns for visible accounts', () => {
    const out = toAccountChartData(rows, accounts, ['a', 'b']);
    expect(out[0].Current).toBe(1000);
    expect(out[0].SIPP).toBeUndefined();
    expect(out[0].total).toBe(6000);
  });

  it('splits liquid vs locked totals', () => {
    const out = toAccountChartData(rows, accounts, ['a', 'b', 'c']);
    expect(out[0].liquid).toBe(6000);
    expect(out[0].locked).toBe(20000);
  });

  it('formats month as "MMM YY"', () => {
    const out = toAccountChartData(rows, accounts, ['a']);
    expect(out[0].month).toMatch(/Apr\s?26/);
  });

  it('returns [] for empty input', () => {
    expect(toAccountChartData([], accounts, [])).toEqual([]);
  });

  it('defaults to all-visible when visibleIds is undefined', () => {
    const out = toAccountChartData(rows, accounts);
    expect(out[0].total).toBe(26000);
  });
});

describe('accountSeriesSpecs', () => {
  const accounts = [
    { id: 'a', name: 'Current' },
    { id: 'b', name: 'Savings' },
    { id: 'c', name: 'SIPP' },
  ];

  it('emits one spec per visible account with palette-ordered colours', () => {
    const specs = accountSeriesSpecs(accounts, ['a', 'b']);
    expect(specs).toHaveLength(2);
    expect(specs[0]).toMatchObject({ key: 'Current', color: LINE_COLORS[0] });
    expect(specs[1]).toMatchObject({ key: 'Savings', color: LINE_COLORS[1] });
  });

  it('skips hidden accounts, palette index follows visible ordering', () => {
    const specs = accountSeriesSpecs(accounts, ['c']);
    expect(specs).toEqual([{ key: 'SIPP', id: 'c', color: LINE_COLORS[0] }]);
  });

  it('cycles palette when more than 12 accounts are visible', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ id: `a${i}`, name: `A${i}` }));
    const specs = accountSeriesSpecs(many);
    expect(specs[12].color).toBe(LINE_COLORS[0]);
    expect(specs[13].color).toBe(LINE_COLORS[1]);
  });
});

describe('getCurrentAge', () => {
  const now = new Date('2026-04-23');

  it('returns year difference', () => {
    expect(getCurrentAge(1982, now)).toBe(44);
  });
  it('rejects garbage', () => {
    expect(getCurrentAge(null, now)).toBeNull();
    expect(getCurrentAge('abc', now)).toBeNull();
    expect(getCurrentAge(1850, now)).toBeNull();
    expect(getCurrentAge(2100, now)).toBeNull();
  });
});
