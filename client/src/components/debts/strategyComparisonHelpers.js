import { STRATEGIES, formatGBP, DEFAULT_PAY_CYCLE } from '../../firebase/schema.js';
import { getCurrentCycleBounds } from '../../services/payCycle.js';

/**
 * Pull the headline metrics out of a runForecast result so comparison rows
 * don't have to dig through the whole object.
 */
export function summarisePlan(forecastResult) {
  const summary = forecastResult?.summary ?? {};
  return {
    totalInterestPennies: summary.totalInterestPennies ?? 0,
    monthsToPayoff: summary.monthsToPayoff ?? 0,
    debtFreeMonth: forecastResult?.debtFreeMonth ?? null,
  };
}

/**
 * A sensible starter budget when the user hasn't set one yet: sum-of-minimums
 * plus 50% headroom, rounded to the nearest £50 so the input reads cleanly.
 * Keeps the comparison informative (all strategies diverge at 50% headroom)
 * without being so large it looks aspirational.
 */
export function suggestBudgetPennies(totalMinPennies) {
  if (!Number.isFinite(totalMinPennies) || totalMinPennies <= 0) return 0;
  const raw = totalMinPennies * 1.5;
  const fiftyPounds = 5000; // pennies
  return Math.max(totalMinPennies, Math.round(raw / fiftyPounds) * fiftyPounds);
}

/**
 * Convert the Dashboard's discretionary number into a Debt Planner budget.
 *
 * Discretionary is "money left after paying bills, minimums, and buffer this
 * cycle" — i.e. the *extra* pool available for debt paydown. The forecast
 * engine's `monthlyBudget` means *total* spend (minimums + extra), so we add
 * the minimums back on top. Clamped to at least the minimums so we never feed
 * the engine a budget that would trigger its min-scaling fallback.
 *
 * Returns null if discretionary isn't yet available (e.g. profile still
 * loading) so the caller can decide how to behave.
 */
export function autoSuggestedBudgetFromDiscretionary(discretionaryPennies, totalMinPennies) {
  if (discretionaryPennies == null || !Number.isFinite(discretionaryPennies)) return null;
  if (!Number.isFinite(totalMinPennies) || totalMinPennies < 0) return null;
  const floor = Math.max(0, totalMinPennies);
  return Math.max(floor, totalMinPennies + Math.max(0, discretionaryPennies));
}

/**
 * Pick the effective monthly budget from the three possible sources:
 * 1. Auto-suggested from discretionary, when the toggle is on and discretionary
 *    is available.
 * 2. The user's saved budget, when one exists.
 * 3. The rule-of-thumb fallback (1.5× minimums, rounded to £50).
 *
 * Shared across StrategyComparison, ForecastChart, and MilestonesCard so the
 * three views agree on "what budget am I projecting under?" at all times.
 */
export function pickEffectiveBudget({
  autoSuggestEnabled,
  discretionaryPennies,
  totalMinPennies,
  savedBudget,
}) {
  if (autoSuggestEnabled) {
    const auto = autoSuggestedBudgetFromDiscretionary(discretionaryPennies, totalMinPennies);
    if (auto != null) return auto;
  }
  if (savedBudget != null) return savedBudget;
  return suggestBudgetPennies(totalMinPennies);
}

/**
 * Human-readable helper text under the Monthly Budget input, explaining where
 * the current value came from (auto-suggested vs custom vs fallback) and why.
 */
export function budgetHelperText({
  autoSuggestEnabled,
  discretionaryPennies,
  totalMinPennies,
  effectiveBudget,
  hasProfile,
}) {
  const mins = `Total minimums: ${formatGBP(totalMinPennies)}/mo`;

  if (!autoSuggestEnabled) {
    return `${mins} · Using your saved budget`;
  }
  if (!hasProfile) {
    return `${mins} · Loading Dashboard discretionary…`;
  }
  if (discretionaryPennies == null) {
    return `${mins} · Auto-suggest unavailable, using fallback`;
  }
  if (discretionaryPennies <= 0) {
    return `${mins} · No discretionary this cycle, covering minimums only`;
  }
  const discretionaryOnly = Math.max(0, effectiveBudget - totalMinPennies);
  return `${mins} + ${formatGBP(discretionaryOnly)} discretionary (auto-suggested from Dashboard)`;
}

/**
 * Return the strategy key with the lowest total interest. Ties break in the
 * order avalanche → hybrid → snowball (roughly "interest-optimal first, then
 * quick-win-friendly"). Used to flag the winner in the comparison table.
 */
export function pickWinnerStrategy(strategiesByKey) {
  const priority = [STRATEGIES.AVALANCHE, STRATEGIES.HYBRID, STRATEGIES.SNOWBALL];
  let best = null;
  let bestInterest = Infinity;
  for (const key of priority) {
    const result = strategiesByKey[key];
    if (!result) continue;
    const interest = result.summary?.totalInterestPennies ?? Infinity;
    if (interest < bestInterest) {
      best = key;
      bestInterest = interest;
    }
  }
  return best;
}

/**
 * The date the forecast should start from — the beginning of the user's
 * current pay cycle, not the first of the calendar month. Aligns projections
 * with how money actually moves for the user (a £150 direct debit on the
 * 25th lands in the cycle it was budgeted for, not the next one), and keeps
 * the Dashboard's "remaining this cycle" numbers compatible with the
 * forecast's month-0 numbers.
 *
 * Falls back to DEFAULT_PAY_CYCLE (28th, preceding_weekday) when no profile
 * is available yet so cards render something coherent on first paint.
 */
export function getForecastStartMonth({ payCycle, holidayCache, now = new Date() }) {
  const cycle = payCycle || DEFAULT_PAY_CYCLE;
  const { start } = getCurrentCycleBounds(now, cycle, holidayCache);
  return start;
}

/**
 * "14 months" / "2y 3m" / "3 years". Short-form for a payoff duration.
 */
export function formatMonthsDuration(months) {
  if (!Number.isFinite(months) || months <= 0) return 'N/A';
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${rem} month${rem === 1 ? '' : 's'}`;
  if (rem === 0) return `${years} year${years === 1 ? '' : 's'}`;
  return `${years}y ${rem}m`;
}

/**
 * Engine returns month labels as "YYYY-MM-DD". Display as "MMM YYYY".
 */
export function formatPayoffMonth(monthLabel) {
  if (typeof monthLabel !== 'string' || monthLabel.length < 7) return monthLabel ?? '';
  const [y, m] = monthLabel.split('-');
  const date = new Date(Number(y), Number(m) - 1, 1);
  if (Number.isNaN(date.getTime())) return monthLabel;
  return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}
