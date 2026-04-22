import { describe, it, expect } from 'vitest';
import {
  toProjectedChartData,
  projectedSeries,
  toUtilisationChartData,
  shortMonth,
  LINE_COLORS,
} from '../forecastChartHelpers.js';

// Mimics runForecast's per-month row shape.
function makeMonth(monthLabel, ending, perDebt) {
  return {
    month: monthLabel,
    ending_debt_pennies: ending,
    per_debt: perDebt,
  };
}

describe('toProjectedChartData', () => {
  it('returns an empty array for no months', () => {
    expect(toProjectedChartData([], [])).toEqual([]);
    expect(toProjectedChartData(null, [])).toEqual([]);
  });

  it('emits one row per month with a short-month label, debt keys, and total', () => {
    const debts = [
      { id: 'a', name: 'Barclaycard' },
      { id: 'b', name: 'Zopa' },
    ];
    const months = [
      makeMonth('2026-05-01', 800000, [
        { debt_id: 'a', ending_pennies: 500000 },
        { debt_id: 'b', ending_pennies: 300000 },
      ]),
      makeMonth('2026-06-01', 700000, [
        { debt_id: 'a', ending_pennies: 450000 },
        { debt_id: 'b', ending_pennies: 250000 },
      ]),
    ];
    const rows = toProjectedChartData(months, debts);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ month: "May '26", Barclaycard: 5000, Zopa: 3000, total: 8000 });
    expect(rows[1]).toEqual({ month: "Jun '26", Barclaycard: 4500, Zopa: 2500, total: 7000 });
  });

  it('skips per_debt rows whose debt_id does not match any known debt (stale state)', () => {
    const debts = [{ id: 'a', name: 'Barclaycard' }];
    const months = [
      makeMonth('2026-05-01', 500000, [
        { debt_id: 'a', ending_pennies: 500000 },
        { debt_id: 'ghost', ending_pennies: 100000 },
      ]),
    ];
    const row = toProjectedChartData(months, debts)[0];
    expect(row.Barclaycard).toBe(5000);
    expect(row.ghost).toBeUndefined();
  });
});

describe('projectedSeries', () => {
  it('returns one series per debt that ever carried a balance, with stable colours', () => {
    const debts = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' }, // never has a balance in the projection
    ];
    const months = [
      makeMonth('2026-05-01', 300000, [
        { debt_id: 'a', ending_pennies: 200000 },
        { debt_id: 'b', ending_pennies: 100000 },
        { debt_id: 'c', ending_pennies: 0, beginning_pennies: 0 },
      ]),
    ];
    const series = projectedSeries(months, debts);
    expect(series.map((s) => s.key)).toEqual(['A', 'B']);
    expect(series[0].color).toBe(LINE_COLORS[0]);
    expect(series[1].color).toBe(LINE_COLORS[1]);
  });

  it('cycles colours when debt count exceeds palette length', () => {
    const debts = Array.from({ length: LINE_COLORS.length + 2 }, (_, i) => ({
      id: String(i), name: `D${i}`,
    }));
    const month = makeMonth('2026-05-01', 0,
      debts.map((d) => ({ debt_id: d.id, ending_pennies: 100 })));
    const series = projectedSeries([month], debts);
    expect(series[LINE_COLORS.length].color).toBe(LINE_COLORS[0]);
    expect(series[LINE_COLORS.length + 1].color).toBe(LINE_COLORS[1]);
  });

  it('returns empty for no months', () => {
    expect(projectedSeries([], [{ id: 'a', name: 'A' }])).toEqual([]);
  });
});

describe('toUtilisationChartData', () => {
  it('returns empty rows + zero eligibleDebtCount when no debt has a limit', () => {
    const debts = [
      { id: 'a', name: 'Loan' }, // no limit
      { id: 'b', name: 'BNPL' },
    ];
    const months = [makeMonth('2026-05-01', 0, [])];
    const out = toUtilisationChartData(months, debts);
    expect(out.rows).toEqual([]);
    expect(out.eligibleDebtCount).toBe(0);
  });

  it('computes utilisation against combined limit across all limited debts', () => {
    // Card £500/£2000 + Overdraft £200/£1000 → 700/3000 ≈ 23.33%
    const debts = [
      { id: 'card', limit_pennies: 200000 },
      { id: 'overdraft', limit_pennies: 100000 },
      { id: 'loan' /* no limit */ },
    ];
    const months = [
      makeMonth('2026-05-01', 0, [
        { debt_id: 'card', ending_pennies: 50000 },
        { debt_id: 'overdraft', ending_pennies: 20000 },
        { debt_id: 'loan', ending_pennies: 900000 }, // ignored for utilisation
      ]),
    ];
    const out = toUtilisationChartData(months, debts);
    expect(out.eligibleDebtCount).toBe(2);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].utilisation).toBeCloseTo(23.33, 1);
  });

  it('caps utilisation at 200% so a brief over-limit spike does not blow out the Y axis', () => {
    const debts = [{ id: 'card', limit_pennies: 100000 }];
    const months = [
      makeMonth('2026-05-01', 0, [{ debt_id: 'card', ending_pennies: 500000 }]), // 500%
    ];
    const out = toUtilisationChartData(months, debts);
    expect(out.rows[0].utilisation).toBe(200);
  });

  it('clamps negative balances (credit on card) to zero', () => {
    const debts = [{ id: 'card', limit_pennies: 100000 }];
    const months = [
      makeMonth('2026-05-01', 0, [{ debt_id: 'card', ending_pennies: -5000 }]),
    ];
    const out = toUtilisationChartData(months, debts);
    expect(out.rows[0].utilisation).toBe(0);
  });
});

describe('shortMonth', () => {
  it('formats "YYYY-MM-DD" as short month + 2-digit year', () => {
    expect(shortMonth('2026-05-01')).toBe("May '26");
    expect(shortMonth('2030-12-01')).toBe("Dec '30");
  });

  it('returns input unchanged for malformed strings', () => {
    expect(shortMonth('')).toBe('');
    expect(shortMonth(null)).toBe('');
    expect(shortMonth('not-a-date')).toBe('not-a-date');
  });
});
