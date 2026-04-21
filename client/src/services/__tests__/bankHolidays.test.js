import { describe, test, expect } from 'vitest';
import {
  buildHolidaySet,
  isBankHoliday,
  isWeekday,
  isWorkingDay,
  precedingWorkingDay,
  followingWorkingDay,
  DIVISIONS,
} from '../bankHolidays.js';

const cache = {
  'england-and-wales': {
    events: [
      { date: '2026-04-03', title: 'Good Friday' },
      { date: '2026-04-06', title: 'Easter Monday' },
      { date: '2026-05-04', title: 'Early May bank holiday' },
      { date: '2026-12-25', title: 'Christmas Day' },
      { date: '2026-12-28', title: 'Boxing Day (substitute)' },
    ],
  },
  'scotland': {
    events: [
      { date: '2026-01-02', title: '2nd January' },
      { date: '2026-11-30', title: "St Andrew's Day" },
    ],
  },
};

describe('buildHolidaySet', () => {
  test('builds set of dates for default division', () => {
    const s = buildHolidaySet(cache);
    expect(s.has('2026-04-03')).toBe(true);
    expect(s.has('2026-11-30')).toBe(false); // Scotland only
  });
  test('empty when no cache', () => {
    expect(buildHolidaySet(null).size).toBe(0);
    expect(buildHolidaySet({}).size).toBe(0);
  });
  test('scotland division', () => {
    const s = buildHolidaySet(cache, DIVISIONS.SCOTLAND);
    expect(s.has('2026-01-02')).toBe(true);
    expect(s.has('2026-04-03')).toBe(false);
  });
});

describe('isBankHoliday', () => {
  test('recognises a known holiday', () => {
    expect(isBankHoliday('2026-12-25', cache)).toBe(true);
  });
  test('ordinary day is not', () => {
    expect(isBankHoliday('2026-12-24', cache)).toBe(false);
  });
  test('accepts Date objects', () => {
    expect(isBankHoliday(new Date(2026, 3, 3), cache)).toBe(true); // April 3rd
  });
  test('no cache → false', () => {
    expect(isBankHoliday('2026-12-25', null)).toBe(false);
  });
});

describe('isWeekday', () => {
  test('Monday-Friday', () => {
    expect(isWeekday(new Date(2026, 3, 20))).toBe(true); // Mon
    expect(isWeekday(new Date(2026, 3, 24))).toBe(true); // Fri
  });
  test('Saturday and Sunday', () => {
    expect(isWeekday(new Date(2026, 3, 25))).toBe(false); // Sat
    expect(isWeekday(new Date(2026, 3, 26))).toBe(false); // Sun
  });
});

describe('isWorkingDay', () => {
  test('weekday + non-holiday → true', () => {
    expect(isWorkingDay(new Date(2026, 3, 21), cache)).toBe(true); // Tue, not a holiday
  });
  test('weekday + holiday → false', () => {
    expect(isWorkingDay(new Date(2026, 3, 6), cache)).toBe(false); // Easter Monday
  });
  test('weekend → false', () => {
    expect(isWorkingDay(new Date(2026, 3, 25), cache)).toBe(false);
  });
});

describe('precedingWorkingDay', () => {
  test('weekday and not holiday → same day', () => {
    const d = precedingWorkingDay(new Date(2026, 3, 21), cache);
    expect(d.getDate()).toBe(21);
  });
  test('saturday → preceding Friday', () => {
    const d = precedingWorkingDay(new Date(2026, 3, 25), cache); // Sat
    expect(d.getDay()).toBe(5);
    expect(d.getDate()).toBe(24);
  });
  test('sunday → preceding Friday', () => {
    const d = precedingWorkingDay(new Date(2026, 3, 26), cache); // Sun
    expect(d.getDate()).toBe(24);
  });
  test('bank holiday Monday → preceding Friday', () => {
    const d = precedingWorkingDay(new Date(2026, 3, 6), cache); // Easter Monday
    expect(d.getDate()).toBe(2); // Thu before Good Friday (Fri 3rd)
  });
  test('Christmas Day (Fri) → Thursday 24th', () => {
    const d = precedingWorkingDay(new Date(2026, 11, 25), cache);
    expect(d.getDate()).toBe(24);
  });
  test('Boxing substitute (Mon 28) → Thursday 24th', () => {
    // 25th Fri holiday, 26 Sat, 27 Sun, 28 Mon substitute
    const d = precedingWorkingDay(new Date(2026, 11, 28), cache);
    expect(d.getDate()).toBe(24);
  });
});

describe('followingWorkingDay', () => {
  test('weekday and not holiday → same day', () => {
    const d = followingWorkingDay(new Date(2026, 3, 21), cache);
    expect(d.getDate()).toBe(21);
  });
  test('saturday → next Monday', () => {
    const d = followingWorkingDay(new Date(2026, 3, 25), cache); // Sat
    expect(d.getDate()).toBe(27);
  });
  test('Good Friday → next working day skipping Easter Monday', () => {
    const d = followingWorkingDay(new Date(2026, 3, 3), cache);
    expect(d.getDate()).toBe(7); // Tuesday after Easter Monday
  });
});
