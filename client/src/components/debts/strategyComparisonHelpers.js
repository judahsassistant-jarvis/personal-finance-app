import { STRATEGIES } from '../../firebase/schema.js';

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
