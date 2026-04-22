import { runForecast } from '../../services/debtForecast.js';

/**
 * Run two forecasts — baseline (user's current plan) and with-injection
 * (same plan + a one-off bonus payment in the specified month) — and return
 * a compact summary of the difference.
 *
 * Keeps UI code pure: the component supplies inputs, this returns ready-to-
 * render numbers. No side effects beyond the two runForecast calls.
 *
 * @param {Object} opts
 * @param {Array}  opts.debts
 * @param {Array}  opts.buckets
 * @param {Date|string} opts.startMonth
 * @param {number} opts.months - projection horizon
 * @param {number|null} opts.monthlyBudget
 * @param {'avalanche'|'snowball'|'hybrid'} opts.strategy
 * @param {number} opts.injectionMonthIndex - 0-based from startMonth
 * @param {number} opts.amountPennies - bonus amount
 * @returns {{
 *   baseline: {totalInterestPennies, monthsToPayoff, debtFreeMonth},
 *   withBonus: {totalInterestPennies, monthsToPayoff, debtFreeMonth},
 *   interestSavedPennies: number,
 *   monthsSaved: number,
 *   injectionAppliedMonth: string|null,
 * }}
 */
export function computeBonusPaymentImpact({
  debts,
  buckets,
  startMonth,
  months = 360,
  monthlyBudget,
  strategy,
  injectionMonthIndex,
  amountPennies,
}) {
  const common = { debts, buckets, startMonth, months, monthlyBudget, strategy };
  const baseline = runForecast(common);
  const withBonus = runForecast({
    ...common,
    oneOffInjection: { monthIndex: injectionMonthIndex, amountPennies },
  });

  const b = baseline.summary;
  const w = withBonus.summary;

  return {
    baseline: summarise(baseline),
    withBonus: summarise(withBonus),
    interestSavedPennies: Math.max(0, b.totalInterestPennies - w.totalInterestPennies),
    monthsSaved: Math.max(0, b.monthsToPayoff - w.monthsToPayoff),
    injectionAppliedMonth: withBonus.months[injectionMonthIndex]?.month ?? null,
  };
}

function summarise(result) {
  return {
    totalInterestPennies: result.summary.totalInterestPennies,
    monthsToPayoff: result.summary.monthsToPayoff,
    debtFreeMonth: result.debtFreeMonth ?? null,
  };
}

/**
 * Convert a YYYY-MM date-input value into a monthIndex relative to a start
 * month at the first of the month. Returns null for invalid input or dates
 * before the start month.
 */
export function dateInputToMonthIndex(dateInputValue, startMonth) {
  if (!dateInputValue || typeof dateInputValue !== 'string') return null;
  const [y, m] = dateInputValue.split('-').map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
  const start = startMonth instanceof Date ? startMonth : new Date(startMonth);
  if (Number.isNaN(start.getTime())) return null;
  const idx = (y - start.getFullYear()) * 12 + (m - 1 - start.getMonth());
  if (idx < 0) return null;
  return idx;
}

/**
 * The default target month for the picker — the first of the current month,
 * rendered as a "YYYY-MM" string for a month-typed input.
 */
export function currentMonthInputValue(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
