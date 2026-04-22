import { describe, it, expect } from 'vitest';
import { STRATEGIES } from '../../../firebase/schema.js';
import {
  summarisePlan,
  suggestBudgetPennies,
  autoSuggestedBudgetFromDiscretionary,
  pickEffectiveBudget,
  getForecastStartMonth,
  budgetHelperText,
  formatMonthsDuration,
  formatPayoffMonth,
  pickWinnerStrategy,
} from '../strategyComparisonHelpers.js';

describe('summarisePlan', () => {
  it('pulls totals from a forecast result', () => {
    const r = {
      summary: { totalInterestPennies: 12345, monthsToPayoff: 24 },
      debtFreeMonth: '2028-05-01',
    };
    expect(summarisePlan(r)).toEqual({
      totalInterestPennies: 12345,
      monthsToPayoff: 24,
      debtFreeMonth: '2028-05-01',
    });
  });

  it('defaults missing fields to zero / null', () => {
    expect(summarisePlan({})).toEqual({
      totalInterestPennies: 0,
      monthsToPayoff: 0,
      debtFreeMonth: null,
    });
    expect(summarisePlan(null)).toEqual({
      totalInterestPennies: 0,
      monthsToPayoff: 0,
      debtFreeMonth: null,
    });
  });
});

describe('suggestBudgetPennies', () => {
  it('returns zero for missing or zero minimums', () => {
    expect(suggestBudgetPennies(0)).toBe(0);
    expect(suggestBudgetPennies(null)).toBe(0);
    expect(suggestBudgetPennies(-100)).toBe(0);
  });

  it('suggests roughly 1.5x the minimums, rounded to nearest £50', () => {
    // £200 × 1.5 = £300 → already a multiple of £50
    expect(suggestBudgetPennies(20000)).toBe(30000);
    // £217.50 × 1.5 = £326.25 → nearest £50 is £350 (dist 23.75 < 26.25 to £300)
    expect(suggestBudgetPennies(21750)).toBe(35000);
    // £210 × 1.5 = £315 → nearest £50 is £300 (dist 15 < 35 to £350)
    expect(suggestBudgetPennies(21000)).toBe(30000);
  });

  it('never returns less than the minimum payments', () => {
    // If rounding would drop below minimums, floor at minimums.
    // 1 × 1.5 = 1.5 → rounds to 0 → clamped to 1p.
    expect(suggestBudgetPennies(1)).toBe(1);
  });
});

describe('formatMonthsDuration', () => {
  it('handles zero / negative / non-finite as N/A', () => {
    expect(formatMonthsDuration(0)).toBe('N/A');
    expect(formatMonthsDuration(-1)).toBe('N/A');
    expect(formatMonthsDuration(NaN)).toBe('N/A');
  });

  it('formats sub-year durations in months', () => {
    expect(formatMonthsDuration(1)).toBe('1 month');
    expect(formatMonthsDuration(11)).toBe('11 months');
  });

  it('formats whole-year durations', () => {
    expect(formatMonthsDuration(12)).toBe('1 year');
    expect(formatMonthsDuration(36)).toBe('3 years');
  });

  it('formats mixed years and months', () => {
    expect(formatMonthsDuration(14)).toBe('1y 2m');
    expect(formatMonthsDuration(27)).toBe('2y 3m');
  });
});

describe('formatPayoffMonth', () => {
  it('formats "YYYY-MM-DD" as "MMM YYYY"', () => {
    expect(formatPayoffMonth('2028-05-01')).toBe('May 2028');
    expect(formatPayoffMonth('2030-12-01')).toBe('Dec 2030');
  });

  it('returns input unchanged for malformed strings', () => {
    expect(formatPayoffMonth('')).toBe('');
    expect(formatPayoffMonth(null)).toBe('');
    expect(formatPayoffMonth('not-a-date')).toBe('not-a-date');
  });
});

describe('getForecastStartMonth', () => {
  const emptyHolidays = { 'england-and-wales': { events: [] } };

  it('returns a Date', () => {
    const start = getForecastStartMonth({ payCycle: null, holidayCache: emptyHolidays });
    expect(start).toBeInstanceOf(Date);
  });

  it('start date is on or before "now"', () => {
    const now = new Date(2026, 3, 15);
    const payCycle = { cadence: 'monthly', day_of_month: 28, shift_rule: 'none', honour_bank_holidays: false };
    const start = getForecastStartMonth({ payCycle, holidayCache: emptyHolidays, now });
    expect(start.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it('uses the default pay cycle (28th, preceding-weekday) when profile is missing', () => {
    // Fallback to DEFAULT_PAY_CYCLE: 28th, preceding_weekday, honour_bank_holidays=true.
    // For now = 2026-04-15 → previous actual pay day was March 27 2026 (a Friday
    // — March 28 was a Saturday, so preceding_weekday shifts to Friday).
    const now = new Date(2026, 3, 15);
    const start = getForecastStartMonth({ payCycle: null, holidayCache: emptyHolidays, now });
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(2); // March
  });

  it('honours the user\'s pay day when provided', () => {
    // Pay day 15th of the month, no shifting.
    const payCycle = { cadence: 'monthly', day_of_month: 15, shift_rule: 'none', honour_bank_holidays: false };
    const now = new Date(2026, 3, 20); // April 20
    const start = getForecastStartMonth({ payCycle, holidayCache: emptyHolidays, now });
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(3); // April
    expect(start.getDate()).toBe(15);
  });

  it('uses the previous cycle when now is before this month\'s pay day', () => {
    const payCycle = { cadence: 'monthly', day_of_month: 15, shift_rule: 'none', honour_bank_holidays: false };
    const now = new Date(2026, 3, 10); // April 10 — before the 15th
    const start = getForecastStartMonth({ payCycle, holidayCache: emptyHolidays, now });
    expect(start.getMonth()).toBe(2); // March (previous cycle)
    expect(start.getDate()).toBe(15);
  });
});

describe('pickEffectiveBudget', () => {
  const base = { totalMinPennies: 15000, savedBudget: null };

  it('uses auto-suggested when enabled and discretionary available', () => {
    // 15000 mins + 20000 discretionary = 35000
    expect(pickEffectiveBudget({
      ...base, autoSuggestEnabled: true, discretionaryPennies: 20000,
    })).toBe(35000);
  });

  it('falls back to saved budget when auto-suggest is off', () => {
    expect(pickEffectiveBudget({
      ...base, autoSuggestEnabled: false, discretionaryPennies: 20000, savedBudget: 40000,
    })).toBe(40000);
  });

  it('falls back to saved budget when auto-suggest is on but discretionary is unavailable', () => {
    expect(pickEffectiveBudget({
      ...base, autoSuggestEnabled: true, discretionaryPennies: null, savedBudget: 40000,
    })).toBe(40000);
  });

  it('falls back to heuristic when no saved budget and no discretionary', () => {
    // suggestBudgetPennies(15000) = 15000 * 1.5 = 22500 → Math.round(4.5) = 5,
    // so nearest £50 rounds up to £250 = 25000 pennies.
    expect(pickEffectiveBudget({
      ...base, autoSuggestEnabled: true, discretionaryPennies: null, savedBudget: null,
    })).toBe(25000);
  });

  it('auto-suggest takes priority over saved budget', () => {
    // auto is 35000, saved is 99999 — auto wins
    expect(pickEffectiveBudget({
      ...base, autoSuggestEnabled: true, discretionaryPennies: 20000, savedBudget: 99999,
    })).toBe(35000);
  });
});

describe('autoSuggestedBudgetFromDiscretionary', () => {
  it('returns null when discretionary is unavailable', () => {
    expect(autoSuggestedBudgetFromDiscretionary(null, 20000)).toBe(null);
    expect(autoSuggestedBudgetFromDiscretionary(undefined, 20000)).toBe(null);
    expect(autoSuggestedBudgetFromDiscretionary(NaN, 20000)).toBe(null);
  });

  it('returns null when totalMin is invalid', () => {
    expect(autoSuggestedBudgetFromDiscretionary(10000, null)).toBe(null);
    expect(autoSuggestedBudgetFromDiscretionary(10000, -1)).toBe(null);
  });

  it('sums minimums + positive discretionary', () => {
    // £150 mins + £200 discretionary = £350 total budget for the engine
    expect(autoSuggestedBudgetFromDiscretionary(20000, 15000)).toBe(35000);
  });

  it('floors at the minimums when discretionary is zero or negative', () => {
    expect(autoSuggestedBudgetFromDiscretionary(0, 15000)).toBe(15000);
    expect(autoSuggestedBudgetFromDiscretionary(-5000, 15000)).toBe(15000);
  });

  it('handles zero minimums', () => {
    expect(autoSuggestedBudgetFromDiscretionary(10000, 0)).toBe(10000);
    expect(autoSuggestedBudgetFromDiscretionary(-10000, 0)).toBe(0);
  });
});

describe('budgetHelperText', () => {
  const base = { totalMinPennies: 15000, effectiveBudget: 35000, hasProfile: true };

  it('describes the auto-suggested breakdown when discretionary is positive', () => {
    const text = budgetHelperText({ ...base, autoSuggestEnabled: true, discretionaryPennies: 20000 });
    expect(text).toContain('£150.00/mo');
    expect(text).toContain('£200.00 discretionary');
    expect(text).toContain('auto-suggested');
  });

  it('flags when there is no discretionary this cycle', () => {
    const text = budgetHelperText({ ...base, autoSuggestEnabled: true, discretionaryPennies: 0, effectiveBudget: 15000 });
    expect(text).toContain('No discretionary');
    expect(text).toContain('minimums only');
  });

  it('flags loading state when profile not yet available', () => {
    const text = budgetHelperText({ ...base, autoSuggestEnabled: true, discretionaryPennies: null, hasProfile: false });
    expect(text).toContain('Loading');
  });

  it('flags fallback when profile loaded but discretionary unavailable', () => {
    const text = budgetHelperText({ ...base, autoSuggestEnabled: true, discretionaryPennies: null, hasProfile: true });
    expect(text).toContain('unavailable');
    expect(text).toContain('fallback');
  });

  it('shows "saved budget" message when auto-suggest is off', () => {
    const text = budgetHelperText({ ...base, autoSuggestEnabled: false, discretionaryPennies: 20000 });
    expect(text).toContain('saved budget');
    expect(text).not.toContain('auto-suggested');
  });
});

describe('pickWinnerStrategy', () => {
  const makeResult = (interest) => ({ summary: { totalInterestPennies: interest } });

  it('picks the lowest-interest strategy', () => {
    const winner = pickWinnerStrategy({
      avalanche: makeResult(10000),
      snowball:  makeResult(20000),
      hybrid:    makeResult(15000),
    });
    expect(winner).toBe(STRATEGIES.AVALANCHE);
  });

  it('breaks ties in avalanche → hybrid → snowball order', () => {
    // avalanche and hybrid tied — avalanche wins.
    expect(pickWinnerStrategy({
      avalanche: makeResult(10000),
      hybrid:    makeResult(10000),
      snowball:  makeResult(20000),
    })).toBe(STRATEGIES.AVALANCHE);

    // hybrid and snowball tied, avalanche higher — hybrid wins.
    expect(pickWinnerStrategy({
      avalanche: makeResult(30000),
      hybrid:    makeResult(10000),
      snowball:  makeResult(10000),
    })).toBe(STRATEGIES.HYBRID);
  });

  it('returns null when no strategies are present', () => {
    expect(pickWinnerStrategy({})).toBe(null);
  });
});
