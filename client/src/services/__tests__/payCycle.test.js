import { describe, test, expect } from 'vitest';
import {
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

describe('getPayDay — Judah default (28th, preceding weekday)', () => {
  test('regular weekday 28th', () => {
    // April 2026: 28th is a Tuesday
    const pay = getPayDay(2026, 3, judahCycle, cache);
    expect(pay.getDate()).toBe(28);
  });
  test('March 2026: 28th is Saturday → preceding Friday 27th', () => {
    const pay = getPayDay(2026, 2, judahCycle, cache);
    expect(pay.getDate()).toBe(27);
  });
  test('November 2026: 28th is Saturday → preceding Friday 27th', () => {
    const pay = getPayDay(2026, 10, judahCycle, cache);
    expect(pay.getDate()).toBe(27);
  });
  test('February 2026: Feb 28th (Sat) → Fri Feb 27th', () => {
    const pay = getPayDay(2026, 1, judahCycle, cache);
    expect(pay.getDate()).toBe(27);
  });
});

describe('getPayDay — shift rule none', () => {
  test('returns exact day even on weekend', () => {
    const pay = getPayDay(2026, 2, { ...judahCycle, shift_rule: SHIFT_RULES.NONE }, cache);
    expect(pay.getDate()).toBe(28); // Sat, left alone
  });
});

describe('getPayDay — following weekday', () => {
  test('Feb 2026 (28th Sat) → Mon Mar 2nd (crosses month)', () => {
    const pay = getPayDay(2026, 1, { ...judahCycle, shift_rule: SHIFT_RULES.FOLLOWING_WEEKDAY }, cache);
    expect(pay.getMonth()).toBe(2);
    expect(pay.getDate()).toBe(2);
  });
});

describe('getPayDay — day_of_month > last day of month', () => {
  test('31st in a 30-day month falls on 30th', () => {
    const pay = getPayDay(2026, 3, { ...judahCycle, day_of_month: 31 }, cache);
    // April 2026: 30th is Thu, weekday → 30th
    expect(pay.getDate()).toBe(30);
  });
  test('31st in Feb (28 days) → Feb 27th (Fri before Sat 28th)', () => {
    const pay = getPayDay(2026, 1, { ...judahCycle, day_of_month: 31 }, cache);
    expect(pay.getDate()).toBe(27);
  });
});

describe('getPayDay — bank holiday collision', () => {
  test('Christmas Day (Fri) paid on Thu 24th', () => {
    const pay = getPayDay(2026, 11, { ...judahCycle, day_of_month: 25 }, cache);
    expect(pay.getDate()).toBe(24);
  });
});

describe('getNextPayDay', () => {
  test('before this month pay day → this month', () => {
    const now = new Date(2026, 3, 15); // April 15
    const pay = getNextPayDay(now, judahCycle, cache);
    expect(pay.getMonth()).toBe(3);
    expect(pay.getDate()).toBe(28);
  });
  test('after this month pay day → next month', () => {
    const now = new Date(2026, 3, 29); // April 29
    const pay = getNextPayDay(now, judahCycle, cache);
    expect(pay.getMonth()).toBe(4); // May
    expect(pay.getDate()).toBe(28); // Thu, no shift
  });
  test('on pay day → that same day', () => {
    const now = new Date(2026, 3, 28);
    const pay = getNextPayDay(now, judahCycle, cache);
    expect(pay.getDate()).toBe(28);
  });
  test('year rollover at Dec 31', () => {
    const cycle = { ...judahCycle, day_of_month: 28 };
    const now = new Date(2026, 11, 29); // after pay
    const pay = getNextPayDay(now, cycle, cache);
    expect(pay.getFullYear()).toBe(2027);
    expect(pay.getMonth()).toBe(0);
  });
});

describe('getPrevPayDay', () => {
  test('after this month pay day → this month', () => {
    const now = new Date(2026, 3, 29);
    const pay = getPrevPayDay(now, judahCycle, cache);
    expect(pay.getMonth()).toBe(3);
    expect(pay.getDate()).toBe(28);
  });
  test('before this month pay day → previous month', () => {
    const now = new Date(2026, 3, 5);
    const pay = getPrevPayDay(now, judahCycle, cache);
    expect(pay.getMonth()).toBe(2); // March
    expect(pay.getDate()).toBe(27); // shifted from Sat 28th
  });
});

describe('getCurrentCycleBounds', () => {
  test('cycle spans previous pay day (inclusive) to next pay day (exclusive)', () => {
    const now = new Date(2026, 3, 15);
    const { start, end } = getCurrentCycleBounds(now, judahCycle, cache);
    expect(start.getMonth()).toBe(2);
    expect(start.getDate()).toBe(27);
    expect(end.getMonth()).toBe(3);
    expect(end.getDate()).toBe(28);
  });
});

describe('daysRemainingInCycle', () => {
  test('mid-cycle returns positive integer', () => {
    const now = new Date(2026, 3, 15);
    expect(daysRemainingInCycle(now, judahCycle, cache)).toBe(13); // 28 - 15
  });
  test('on pay day → 0', () => {
    const now = new Date(2026, 3, 28);
    expect(daysRemainingInCycle(now, judahCycle, cache)).toBe(0);
  });
  test('day before pay day → 1', () => {
    const now = new Date(2026, 3, 27);
    expect(daysRemainingInCycle(now, judahCycle, cache)).toBe(1);
  });
});
