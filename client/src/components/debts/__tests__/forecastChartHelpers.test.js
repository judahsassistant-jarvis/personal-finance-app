import { describe, it, expect } from 'vitest';
import {
  toProjectedChartData,
  projectedSeries,
  toUtilisationChartData,
  toActualChartData,
  toSavingsChartData,
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

describe('toActualChartData', () => {
  const debts = [
    { id: 'd1', name: 'Zopa' },
    { id: 'd2', name: 'Klarna' },
  ];
  const months = [
    { month: '2026-05-01', ending_debt_pennies: 0, per_debt: [
      { debt_id: 'd1', ending_pennies: 500000 },
      { debt_id: 'd2', ending_pennies: 60000 },
    ]},
    { month: '2026-06-01', ending_debt_pennies: 0, per_debt: [
      { debt_id: 'd1', ending_pennies: 450000 },
      { debt_id: 'd2', ending_pennies: 50000 },
    ]},
    { month: '2026-07-01', ending_debt_pennies: 0, per_debt: [
      { debt_id: 'd1', ending_pennies: 400000 },
      { debt_id: 'd2', ending_pennies: 40000 },
    ]},
  ];

  it('returns the base projected rows when no snapshots are provided', () => {
    const out = toActualChartData(months, debts, []);
    expect(out).toHaveLength(3);
    expect(out[0]).not.toHaveProperty('Zopa_actual');
  });

  it('attaches `${name}_actual` only to the row the snapshot falls in', () => {
    const mayMs = new Date('2026-05-15').getTime();
    const snapshots = [{ debt_id: 'd1', as_of_date: mayMs, balance_pennies: 490000 }];
    const out = toActualChartData(months, debts, snapshots);
    expect(out[0]).toHaveProperty('Zopa_actual', 4900); // pennies → pounds
    expect(out[1]).not.toHaveProperty('Zopa_actual');
    expect(out[2]).not.toHaveProperty('Zopa_actual');
    // Klarna untouched throughout
    expect(out.every((r) => !('Klarna_actual' in r))).toBe(true);
  });

  it('uses the latest snapshot when multiple fall in the same row', () => {
    const early = new Date('2026-05-03').getTime();
    const late  = new Date('2026-05-28').getTime();
    const snapshots = [
      { debt_id: 'd1', as_of_date: early, balance_pennies: 510000 },
      { debt_id: 'd1', as_of_date: late,  balance_pennies: 495000 },
    ];
    const out = toActualChartData(months, debts, snapshots);
    expect(out[0].Zopa_actual).toBe(4950);
  });

  it('clamps a snapshot dated just before the forecast start to row 0', () => {
    // Common case: pay-cycle-aligned forecast starts late in the calendar
    // month, but the user recorded a statement a week earlier. That snapshot
    // is still "current cycle" data and should show as the month-0 actual.
    const justBefore = new Date('2026-04-28').getTime(); // before the May row
    const snapshots = [{ debt_id: 'd1', as_of_date: justBefore, balance_pennies: 510000 }];
    const out = toActualChartData(months, debts, snapshots);
    expect(out[0].Zopa_actual).toBe(5100);
    expect(out[1]).not.toHaveProperty('Zopa_actual');
  });

  it('clamps a much-earlier snapshot to row 0 too (latest authoritative balance wins)', () => {
    const oldSnap = new Date('2025-10-15').getTime(); // months before
    const snapshots = [{ debt_id: 'd1', as_of_date: oldSnap, balance_pennies: 600000 }];
    const out = toActualChartData(months, debts, snapshots);
    expect(out[0].Zopa_actual).toBe(6000);
  });

  it('assigns snapshots after the last forecast row to the last row', () => {
    const future = new Date('2026-12-31').getTime();
    const snapshots = [{ debt_id: 'd1', as_of_date: future, balance_pennies: 100000 }];
    const out = toActualChartData(months, debts, snapshots);
    expect(out[2].Zopa_actual).toBe(1000);
    expect(out[1]).not.toHaveProperty('Zopa_actual');
  });

  it('ignores snapshots whose debt_id is not in the debts list', () => {
    const mayMs = new Date('2026-05-15').getTime();
    const snapshots = [{ debt_id: 'ghost', as_of_date: mayMs, balance_pennies: 999999 }];
    const out = toActualChartData(months, debts, snapshots);
    expect(out[0]).not.toHaveProperty('ghost_actual');
    expect(out[0]).not.toHaveProperty('Zopa_actual');
  });

  it('returns an empty array for empty forecast input', () => {
    expect(toActualChartData([], debts, [])).toEqual([]);
  });
});

describe('toSavingsChartData', () => {
  it('returns an empty array for empty inputs', () => {
    expect(toSavingsChartData([], [])).toEqual([]);
    expect(toSavingsChartData(null, null)).toEqual([]);
  });

  it('computes cumulative interest saved month by month', () => {
    const plan = [
      { month: '2026-05-01', interest_pennies: 1000 },
      { month: '2026-06-01', interest_pennies: 900 },
      { month: '2026-07-01', interest_pennies: 800 },
    ];
    const minOnly = [
      { month: '2026-05-01', interest_pennies: 2000 },
      { month: '2026-06-01', interest_pennies: 1800 },
      { month: '2026-07-01', interest_pennies: 1600 },
    ];
    const out = toSavingsChartData(plan, minOnly);
    // Month 0: (2000) - (1000) = 1000p = £10
    expect(out[0].savedPounds).toBeCloseTo(10, 5);
    // Month 1: (2000+1800) - (1000+900) = 1900p = £19
    expect(out[1].savedPounds).toBeCloseTo(19, 5);
    // Month 2: (2000+1800+1600) - (1000+900+800) = 2700p = £27
    expect(out[2].savedPounds).toBeCloseTo(27, 5);
  });

  it('clamps savings to zero when the plan somehow accrues more than min-only', () => {
    const plan = [{ month: '2026-05-01', interest_pennies: 5000 }];
    const minOnly = [{ month: '2026-05-01', interest_pennies: 1000 }];
    const out = toSavingsChartData(plan, minOnly);
    expect(out[0].savedPounds).toBe(0);
  });

  it('handles a shorter min-only array — uses 0 for the missing months', () => {
    const plan = [
      { month: '2026-05-01', interest_pennies: 1000 },
      { month: '2026-06-01', interest_pennies: 1000 },
    ];
    const minOnly = [
      { month: '2026-05-01', interest_pennies: 3000 },
      // no June row
    ];
    const out = toSavingsChartData(plan, minOnly);
    expect(out[0].savedPounds).toBeCloseTo(20, 5);   // 3000 - 1000 = 2000p
    expect(out[1].savedPounds).toBeCloseTo(10, 5);   // still 3000 total - 2000 total = 1000p
  });

  it('continues past plan end — most savings accrue after the plan is paid off', () => {
    // Plan pays off in 2 months (no more interest after). Min-only keeps
    // paying interest for 4 months. The chart should run to 4 months, and
    // savings should GROW after month 2 as min-only keeps charging.
    const plan = [
      { month: '2026-05-01', interest_pennies: 500 },
      { month: '2026-06-01', interest_pennies: 200 },
      // plan is done — no months 3/4
    ];
    const minOnly = [
      { month: '2026-05-01', interest_pennies: 500 },
      { month: '2026-06-01', interest_pennies: 500 },
      { month: '2026-07-01', interest_pennies: 500 },
      { month: '2026-08-01', interest_pennies: 500 },
    ];
    const out = toSavingsChartData(plan, minOnly);
    expect(out).toHaveLength(4);
    // month 0: both paid 500p → 0 saved
    expect(out[0].savedPounds).toBeCloseTo(0, 5);
    // month 1: plan +200, min +500 → 300p saved = £3
    expect(out[1].savedPounds).toBeCloseTo(3, 5);
    // month 2: plan still at 700 (done), min at 1500 → 800p saved = £8
    expect(out[2].savedPounds).toBeCloseTo(8, 5);
    // month 3: plan still 700, min 2000 → 1300p = £13
    expect(out[3].savedPounds).toBeCloseTo(13, 5);
  });

  it('uses the longer array\'s month labels for the X axis', () => {
    const plan = [{ month: '2026-05-01', interest_pennies: 100 }];
    const minOnly = [
      { month: '2026-05-01', interest_pennies: 200 },
      { month: '2026-06-01', interest_pennies: 200 },
    ];
    const out = toSavingsChartData(plan, minOnly);
    expect(out).toHaveLength(2);
    expect(out[1].month).toBe("Jun '26");
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
