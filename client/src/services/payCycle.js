/**
 * Pay cycle arithmetic.
 *
 * There are two distinct concepts here:
 *
 *  1. **Nominal pay day** — the date the user's payroll is labelled for
 *     (e.g. "28th of every month"). This defines the cycle boundaries:
 *     cycle N starts on its nominal payday and ends the day before cycle N+1.
 *
 *  2. **Actual pay day** — the date the money actually lands in the account,
 *     after the shift_rule is applied (e.g. 28th Mar 2026 is a Saturday, so
 *     with preceding_weekday it actually deposits on Friday 27th).
 *
 * Cycle bounds use NOMINAL paydays. "Days to payday" and deposit dates use
 * ACTUAL (shifted) dates.
 *
 * Monthly cadence handled in 2a. Weekly / bi-weekly / 4-weekly throw.
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

// ---------------------------------------------------------------------------
// Nominal (unshifted) — for cycle bounds
// ---------------------------------------------------------------------------

/** The nominal pay day in (year, month). Day-of-month > days-in-month clamps down. */
export function getNominalPayDay(year, month, cycle) {
  if (cycle.cadence !== CADENCES.MONTHLY) {
    throw new Error(`getNominalPayDay only supports monthly cadence in 2a (got ${cycle.cadence})`);
  }
  const day = Math.min(cycle.day_of_month || 28, daysInMonth(year, month));
  return new Date(year, month, day);
}

/** Most recent nominal pay day on or before `now`. */
export function getPrevNominalPayDay(now, cycle) {
  const today = startOfDay(now);
  const candidate = getNominalPayDay(today.getFullYear(), today.getMonth(), cycle);
  if (candidate <= today) return candidate;
  const prev = today.getMonth() === 0
    ? new Date(today.getFullYear() - 1, 11, 1)
    : new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return getNominalPayDay(prev.getFullYear(), prev.getMonth(), cycle);
}

/** Next nominal pay day strictly after `now`. */
export function getNextNominalPayDay(now, cycle) {
  const today = startOfDay(now);
  const candidate = getNominalPayDay(today.getFullYear(), today.getMonth(), cycle);
  if (candidate > today) return candidate;
  const next = today.getMonth() === 11
    ? new Date(today.getFullYear() + 1, 0, 1)
    : new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return getNominalPayDay(next.getFullYear(), next.getMonth(), cycle);
}

// ---------------------------------------------------------------------------
// Actual (shifted) — for deposit dates and days-to-payday
// ---------------------------------------------------------------------------

function applyShift(date, cycle, holidayCache) {
  const division = cycle.division;
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

/** Actual deposit date in (year, month) — nominal plus shift_rule. */
export function getPayDay(year, month, cycle, holidayCache) {
  const nominal = getNominalPayDay(year, month, cycle);
  return applyShift(nominal, cycle, holidayCache);
}

/** Next actual deposit date on or after `now`. */
export function getNextPayDay(now, cycle, holidayCache) {
  const today = startOfDay(now);
  const thisMonth = getPayDay(today.getFullYear(), today.getMonth(), cycle, holidayCache);
  if (thisMonth >= today) return thisMonth;
  const next = today.getMonth() === 11
    ? new Date(today.getFullYear() + 1, 0, 1)
    : new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return getPayDay(next.getFullYear(), next.getMonth(), cycle, holidayCache);
}

/** Most recent actual deposit date strictly before `now`. */
export function getPrevPayDay(now, cycle, holidayCache) {
  const today = startOfDay(now);
  const thisMonth = getPayDay(today.getFullYear(), today.getMonth(), cycle, holidayCache);
  if (thisMonth < today) return thisMonth;
  const prev = today.getMonth() === 0
    ? new Date(today.getFullYear() - 1, 11, 1)
    : new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return getPayDay(prev.getFullYear(), prev.getMonth(), cycle, holidayCache);
}

// ---------------------------------------------------------------------------
// Cycle + countdown
// ---------------------------------------------------------------------------

/**
 * Current pay cycle as [start, end) using ACTUAL (shifted) pay dates.
 *
 * `start` is the most recent actual deposit date on or before `now` — so if
 * today is the actual pay day, the new cycle has already begun.
 * `end` is the actual deposit date of the following pay period.
 *
 * For the inclusive-end display ("cycle ends 27 Apr"), subtract a day from
 * `end` at render time.
 *
 * Example: nominal 28th with preceding_weekday rule in April 2026:
 *   On 15 Apr → cycle is [27 Mar Fri, 28 Apr Tue); displays as "27 Mar → 27 Apr".
 *   On 28 Apr → cycle is [28 Apr Tue, 28 May Thu); displays as "28 Apr → 27 May".
 */
export function getCurrentCycleBounds(now, cycle, holidayCache) {
  const today = startOfDay(now);

  // Start: most recent actual deposit ≤ today.
  const thisActual = getPayDay(today.getFullYear(), today.getMonth(), cycle, holidayCache);
  const start = thisActual <= today
    ? thisActual
    : getPayDay(
      today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear(),
      today.getMonth() === 0 ? 11 : today.getMonth() - 1,
      cycle,
      holidayCache,
    );

  // End: actual deposit of the month after `start`.
  const end = getPayDay(
    start.getMonth() === 11 ? start.getFullYear() + 1 : start.getFullYear(),
    start.getMonth() === 11 ? 0 : start.getMonth() + 1,
    cycle,
    holidayCache,
  );

  return { start, end };
}

/** Integer days from `now` to the next ACTUAL deposit date. 0 means today. */
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
