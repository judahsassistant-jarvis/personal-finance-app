/**
 * Pay cycle arithmetic — the core of the Snoop-style Dashboard.
 *
 * Given a user's pay cycle (day_of_month + cadence + shift_rule) and a bank
 * holiday cache, computes:
 *
 *   - `getPayDay(year, month, cycle, holidayCache)` → Date for a specific month
 *   - `getNextPayDay(now, cycle, holidayCache)` → upcoming pay day
 *   - `getPrevPayDay(now, cycle, holidayCache)` → most recent past pay day
 *   - `getCurrentCycleBounds(now, cycle, holidayCache)` → {start, end} of current cycle
 *   - `daysRemainingInCycle(now, cycle, holidayCache)` → integer day count to next pay
 *
 * 2a scope handles `monthly` cadence with shift_rule applied. Weekly /
 * bi-weekly / 4-weekly are stubs — the shape is the same, arithmetic is
 * simpler (no day-of-month logic), implement when Judah has such accounts.
 */

import { precedingWorkingDay, followingWorkingDay } from './bankHolidays.js';

export const CADENCES = Object.freeze({
  MONTHLY: 'monthly',
  FOUR_WEEKLY: '4-weekly',
  BI_WEEKLY: 'bi-weekly',
  WEEKLY: 'weekly',
});

export const SHIFT_RULES = Object.freeze({
  NONE: 'none',
  PRECEDING_WEEKDAY: 'preceding_weekday',
  FOLLOWING_WEEKDAY: 'following_weekday',
});

/** Apply the shift rule to a raw pay date. */
function applyShift(date, cycle, holidayCache) {
  const division = cycle.division; // may be undefined — service uses default
  switch (cycle.shift_rule) {
    case SHIFT_RULES.PRECEDING_WEEKDAY:
      return precedingWorkingDay(date, cycle.honour_bank_holidays ? holidayCache : null, division);
    case SHIFT_RULES.FOLLOWING_WEEKDAY:
      return followingWorkingDay(date, cycle.honour_bank_holidays ? holidayCache : null, division);
    case SHIFT_RULES.NONE:
    default:
      return new Date(date);
  }
}

/** The pay date in a specific (year, month) — month is 0-indexed like Date. */
export function getPayDay(year, month, cycle, holidayCache) {
  if (cycle.cadence !== CADENCES.MONTHLY) {
    throw new Error(`getPayDay only supports monthly cadence in 2a (got ${cycle.cadence})`);
  }
  const day = Math.min(cycle.day_of_month || 28, daysInMonth(year, month));
  const raw = new Date(year, month, day);
  return applyShift(raw, cycle, holidayCache);
}

/** Next pay day on or after `now`. */
export function getNextPayDay(now, cycle, holidayCache) {
  const today = startOfDay(now);
  const thisMonth = getPayDay(today.getFullYear(), today.getMonth(), cycle, holidayCache);
  if (thisMonth >= today) return thisMonth;
  const next = today.getMonth() === 11
    ? new Date(today.getFullYear() + 1, 0, 1)
    : new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return getPayDay(next.getFullYear(), next.getMonth(), cycle, holidayCache);
}

/** Most recent pay day strictly before `now`. */
export function getPrevPayDay(now, cycle, holidayCache) {
  const today = startOfDay(now);
  const thisMonth = getPayDay(today.getFullYear(), today.getMonth(), cycle, holidayCache);
  if (thisMonth < today) return thisMonth;
  const prev = today.getMonth() === 0
    ? new Date(today.getFullYear() - 1, 11, 1)
    : new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return getPayDay(prev.getFullYear(), prev.getMonth(), cycle, holidayCache);
}

/** {start, end} bracketing the current pay cycle. `start` inclusive, `end` exclusive. */
export function getCurrentCycleBounds(now, cycle, holidayCache) {
  const today = startOfDay(now);
  const prev = getPrevPayDay(today, cycle, holidayCache);
  const next = getNextPayDay(today, cycle, holidayCache);
  return { start: prev, end: next };
}

/** Integer day count from `now` to the next pay day. 0 means today is pay day. */
export function daysRemainingInCycle(now, cycle, holidayCache) {
  const today = startOfDay(now);
  const next = getNextPayDay(today, cycle, holidayCache);
  const ms = next - today;
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startOfDay(d) {
  const x = d instanceof Date ? new Date(d) : new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}
