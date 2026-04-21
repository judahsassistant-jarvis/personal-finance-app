/**
 * UK bank-holiday lookups.
 *
 * Source of truth is gov.uk/bank-holidays.json, refreshed weekly by the
 * refreshBankHolidays Cloud Function into system/bank_holidays. This module
 * queries that cached document and provides working-day adjustments.
 *
 * Division: defaults to "england-and-wales". User can override per account /
 * per pay cycle in the future (Settings UI in Sprint 4c).
 *
 * The service accepts a `holidayCache` in the shape the Cloud Function writes
 * (see refreshBankHolidays) — pure-function friendly for tests.
 *
 * Expected shape:
 * {
 *   "england-and-wales": { events: [{date: "YYYY-MM-DD", title: "..."}, ...] },
 *   "scotland": { events: [...] },
 *   "northern-ireland": { events: [...] }
 * }
 */

export const DIVISIONS = Object.freeze({
  ENGLAND_AND_WALES: 'england-and-wales',
  SCOTLAND: 'scotland',
  NORTHERN_IRELAND: 'northern-ireland',
});

export const DEFAULT_DIVISION = DIVISIONS.ENGLAND_AND_WALES;

/** Build a Set of ISO dates (YYYY-MM-DD) for the given division. */
export function buildHolidaySet(holidayCache, division = DEFAULT_DIVISION) {
  if (!holidayCache || !holidayCache[division]) return new Set();
  const events = holidayCache[division].events || [];
  return new Set(events.map((e) => e.date));
}

/** Is the given date a bank holiday in the given division? */
export function isBankHoliday(date, holidayCache, division = DEFAULT_DIVISION) {
  const iso = toIsoDate(date);
  if (!iso) return false;
  const set = buildHolidaySet(holidayCache, division);
  return set.has(iso);
}

/** Monday-Friday check, ignoring holidays. */
export function isWeekday(date) {
  const d = toDate(date);
  if (!d) return false;
  const dow = d.getDay();
  return dow >= 1 && dow <= 5;
}

/** Full working day check: weekday AND not a bank holiday. */
export function isWorkingDay(date, holidayCache, division = DEFAULT_DIVISION) {
  return isWeekday(date) && !isBankHoliday(date, holidayCache, division);
}

/**
 * Walk backwards from `date` until a working day is found. Returns a new Date.
 * The input day itself is tested first — if it's already a working day, returned
 * unchanged.
 */
export function precedingWorkingDay(date, holidayCache, division = DEFAULT_DIVISION) {
  const d = toDate(date);
  if (!d) return null;
  const cursor = new Date(d);
  // Safety cap — bank-holiday weeks never exceed 7 consecutive non-working days.
  for (let i = 0; i < 10; i++) {
    if (isWorkingDay(cursor, holidayCache, division)) return cursor;
    cursor.setDate(cursor.getDate() - 1);
  }
  return cursor;
}

/**
 * Walk forwards from `date` until a working day is found.
 */
export function followingWorkingDay(date, holidayCache, division = DEFAULT_DIVISION) {
  const d = toDate(date);
  if (!d) return null;
  const cursor = new Date(d);
  for (let i = 0; i < 10; i++) {
    if (isWorkingDay(cursor, holidayCache, division)) return cursor;
    cursor.setDate(cursor.getDate() + 1);
  }
  return cursor;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDate(v) {
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  if (typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(v);
    if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  return null;
}

function toIsoDate(v) {
  const d = toDate(v);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
