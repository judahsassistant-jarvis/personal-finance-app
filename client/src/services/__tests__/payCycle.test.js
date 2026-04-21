import { describe, test, expect } from 'vitest';
import {
  getNominalPayDay,
  getPrevNominalPayDay,
  getNextNominalPayDay,
  getPayDay,
  getNextPayDay,
  getPrevPayDay,
  getCurrentCycleBounds,
  daysRemainingInCycle,
  CADENCES,
  SHIFT_RULES,
} from '../payCycle.js';

const cache = {
  'england-and-wales': {
    events: [
      { date: '2026-04-03', title: 'Good Friday' },
      { date: '2026-04-06', title: 'Easter Monday' },
      { date: '2026-12-25', title: 'Christmas Day' },
      { date: '2026-12-28', title: 'Boxing (substitute)' },
    ],
  },
};

const judahCycle = {
  cadence: CADENCES.MONTHLY,
  day_of_month: 28,
  shift_rule: SHIFT_RULES.PRECEDING_WEEKDAY,
  honour_bank_holidays: true,
};

describe('getNominalPayDay — never shifts', () => {
  test('returns the 28th even when it falls on a weekend', () => {
    const d = getNominalPayDay(2026, 2, judahCycle); // March 2026
    expect(d.getDate()).toBe(28);
    expect(d.getDay()).toBe(6); // Saturday
  });
  test('clamps day-of-month to the last day of the month', () => {
    const d = getNominalPayDay(2026, 1, { ...judahCycle, day_of_month: 31 }); // Feb 2026
    expect(d.getDate()).toBe(28); // Feb has 28 days
  });
});

describe('getPayDay — actual (shifted) deposit', () => {
  test('weekday nominal → same day', () => {
    const pay = getPayDay(2026, 3, judahCycle, cache); // April 2026 — 28th is Tue
    expect(pay.getDate()).toBe(28);
  });
  test('March 2026 nominal on Sat → shifts to Fri 27th', () => {
    const pay = getPayDay(2026, 2, judahCycle, cache);
    expect(pay.getDate()).toBe(27);
  });
  test('shift_rule=none returns raw nominal date', () => {
    const pay = getPayDay(2026, 2, { ...judahCycle, shift_rule: SHIFT_RULES.NONE }, cache);
    expect(pay.getDate()).toBe(28);
  });
  test('following_weekday on Sat Feb 28 → Mon Mar 2', () => {
    const pay = getPayDay(2026, 1, { ...judahCycle, shift_rule: SHIFT_RULES.FOLLOWING_WEEKDAY }, cache);
    expect(pay.getMonth()).toBe(2);
    expect(pay.getDate()).toBe(2);
  });
  test('Christmas Day (Fri) → Thu 24th when preceding_weekday + honour_bank_holidays', () => {
    const pay = getPayDay(2026, 11, { ...judahCycle, day_of_month: 25 }, cache);
    expect(pay.getDate()).toBe(24);
  });
});

describe('getPrevNominalPayDay — most recent nominal on or before now', () => {
  test('mid-cycle (Apr 15) → March 28', () => {
    const now = new Date(2026, 3, 15);
    const prev = getPrevNominalPayDay(now, judahCycle);
    expect(prev.getMonth()).toBe(2);
    expect(prev.getDate()).toBe(28);
  });
  test('on nominal payday (Apr 28) → Apr 28 itself', () => {
    const now = new Date(2026, 3, 28);
    const prev = getPrevNominalPayDay(now, judahCycle);
    expect(prev.getMonth()).toBe(3);
    expect(prev.getDate()).toBe(28);
  });
  test('day after payday (Apr 29) → Apr 28', () => {
    const now = new Date(2026, 3, 29);
    const prev = getPrevNominalPayDay(now, judahCycle);
    expect(prev.getDate()).toBe(28);
  });
});

describe('getNextNominalPayDay — next nominal strictly after now', () => {
  test('mid-cycle (Apr 15) → Apr 28', () => {
    const now = new Date(2026, 3, 15);
    const next = getNextNominalPayDay(now, judahCycle);
    expect(next.getMonth()).toBe(3);
    expect(next.getDate()).toBe(28);
  });
  test('on nominal payday (Apr 28) → next is May 28', () => {
    const now = new Date(2026, 3, 28);
    const next = getNextNominalPayDay(now, judahCycle);
    expect(next.getMonth()).toBe(4);
    expect(next.getDate()).toBe(28);
  });
  test('Dec 29 → Jan 28 next year', () => {
    const now = new Date(2026, 11, 29);
    const next = getNextNominalPayDay(now, judahCycle);
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(0);
  });
});

describe('getCurrentCycleBounds — uses ACTUAL (shifted) paydays', () => {
  test('mid-cycle April 15 → [Fri 27 Mar, Tue 28 Apr)', () => {
    const { start, end } = getCurrentCycleBounds(new Date(2026, 3, 15), judahCycle, cache);
    expect(start.getMonth()).toBe(2);
    expect(start.getDate()).toBe(27);   // shifted from Sat 28 Mar
    expect(end.getMonth()).toBe(3);
    expect(end.getDate()).toBe(28);     // Tue, no shift
  });
  test('on actual payday Fri 27 Mar → new cycle [27 Mar, 28 Apr)', () => {
    const { start, end } = getCurrentCycleBounds(new Date(2026, 2, 27), judahCycle, cache);
    expect(start.getMonth()).toBe(2);
    expect(start.getDate()).toBe(27);
    expect(end.getMonth()).toBe(3);
    expect(end.getDate()).toBe(28);
  });
  test('day after nominal Sat 28 Mar (still same cycle)', () => {
    const { start, end } = getCurrentCycleBounds(new Date(2026, 2, 29), judahCycle, cache);
    expect(start.getDate()).toBe(27);
    expect(end.getDate()).toBe(28);
  });
  test('on Tue 28 Apr → new cycle [28 Apr, 28 May)', () => {
    const { start, end } = getCurrentCycleBounds(new Date(2026, 3, 28), judahCycle, cache);
    expect(start.getMonth()).toBe(3);
    expect(start.getDate()).toBe(28);
    expect(end.getMonth()).toBe(4);
    expect(end.getDate()).toBe(28);     // Thu, no shift
  });
  test('Mon 27 Apr (day before next pay) → still [27 Mar, 28 Apr)', () => {
    const { start, end } = getCurrentCycleBounds(new Date(2026, 3, 27), judahCycle, cache);
    expect(start.getMonth()).toBe(2);
    expect(start.getDate()).toBe(27);
    expect(end.getMonth()).toBe(3);
    expect(end.getDate()).toBe(28);
  });
  test('shift_rule=none → cycle bounds are nominal (28th everywhere)', () => {
    const cycleNoShift = { ...judahCycle, shift_rule: SHIFT_RULES.NONE };
    const { start, end } = getCurrentCycleBounds(new Date(2026, 3, 15), cycleNoShift, cache);
    expect(start.getDate()).toBe(28);
    expect(end.getDate()).toBe(28);
  });
});

describe('getNextPayDay — ACTUAL (shifted) next deposit', () => {
  test('before this month’s deposit → this month', () => {
    const pay = getNextPayDay(new Date(2026, 3, 15), judahCycle, cache);
    expect(pay.getMonth()).toBe(3);
    expect(pay.getDate()).toBe(28);
  });
  test('after this month’s deposit → next month', () => {
    const pay = getNextPayDay(new Date(2026, 3, 29), judahCycle, cache);
    expect(pay.getMonth()).toBe(4);
    expect(pay.getDate()).toBe(28);
  });
});

describe('daysRemainingInCycle — to ACTUAL next deposit', () => {
  test('mid-cycle returns difference to actual deposit day', () => {
    const now = new Date(2026, 3, 15);
    expect(daysRemainingInCycle(now, judahCycle, cache)).toBe(13);
  });
  test('on deposit day → 0', () => {
    const now = new Date(2026, 3, 28);
    expect(daysRemainingInCycle(now, judahCycle, cache)).toBe(0);
  });
  test('March 14 → deposit is Fri 27 (nominal Sat shifted) so 13 days', () => {
    const now = new Date(2026, 2, 14);
    expect(daysRemainingInCycle(now, judahCycle, cache)).toBe(13);
  });
});

describe('getPrevPayDay — ACTUAL (shifted) previous deposit', () => {
  test('April 15 → actual prev is Fri 27 Mar (nominal Sat 28 shifted)', () => {
    const prev = getPrevPayDay(new Date(2026, 3, 15), judahCycle, cache);
    expect(prev.getMonth()).toBe(2);
    expect(prev.getDate()).toBe(27);
  });
});
