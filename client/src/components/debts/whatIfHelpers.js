import { runForecast } from '../../services/debtForecast.js';
import { applySingleTransfer, applyMultiAllocation } from '../../services/whatIfEngine.js';

export const WHAT_IF_MODES = Object.freeze({
  SINGLE: 'single',
  MULTI: 'multi',
});

/**
 * Run the baseline forecast and the with-BT forecast in one shot, returning a
 * compact result object for the UI. Net savings = interest saved − BT fee, so
 * the user can see whether the transfer is actually value-positive after the
 * fee is paid.
 *
 * @param {Object} opts
 * @param {Array}  opts.debts
 * @param {Array}  opts.buckets
 * @param {Date|string} opts.startMonth
 * @param {number} opts.months
 * @param {number|null} opts.monthlyBudget
 * @param {'avalanche'|'snowball'|'hybrid'} opts.strategy
 * @param {'single'|'multi'} opts.mode
 * @param {Object} opts.params - mode-specific params for the engine
 */
export function computeWhatIfImpact({
  debts, buckets, startMonth, months = 360,
  monthlyBudget, strategy,
  mode, params,
}) {
  const baseline = runForecast({ debts, buckets, startMonth, months, monthlyBudget, strategy });

  const applied = mode === WHAT_IF_MODES.MULTI
    ? applyMultiAllocation({ debts, buckets }, params)
    : applySingleTransfer({ debts, buckets }, params);

  const withBt = runForecast({
    debts: applied.debts,
    buckets: applied.buckets,
    startMonth,
    months,
    monthlyBudget,
    strategy,
  });

  const interestSavedPennies = Math.max(0, baseline.summary.totalInterestPennies - withBt.summary.totalInterestPennies);
  const monthsSaved = Math.max(0, baseline.summary.monthsToPayoff - withBt.summary.monthsToPayoff);
  const feePennies = applied.transfer?.feePennies ?? 0;
  const netSavingsPennies = interestSavedPennies - feePennies;

  return {
    baseline: summarise(baseline),
    withBt: summarise(withBt),
    interestSavedPennies,
    monthsSaved,
    feePennies,
    netSavingsPennies,
    allocations: applied.allocations ?? null,
    transferPennies: applied.transfer?.transferPennies ?? applied.transfer?.totalTransferPennies ?? 0,
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
 * Decide whether the form's current inputs are complete enough to run the
 * engine. Pulled out of the component so we can test the rules without
 * mounting React.
 */
export function whatIfInputsValid(mode, fields) {
  if (mode === WHAT_IF_MODES.SINGLE) {
    return Boolean(
      fields.sourceDebtId &&
      Number.isFinite(fields.transferPennies) && fields.transferPennies > 0 &&
      Number.isFinite(fields.standardApr) && fields.standardApr >= 0 &&
      Number.isFinite(fields.promoMonths) && fields.promoMonths >= 0 &&
      Number.isFinite(fields.promoApr) && fields.promoApr >= 0 &&
      Number.isFinite(fields.feePercent) && fields.feePercent >= 0,
    );
  }
  if (mode === WHAT_IF_MODES.MULTI) {
    return Boolean(
      Number.isFinite(fields.availableLimitPennies) && fields.availableLimitPennies > 0 &&
      Array.isArray(fields.eligibleDebtIds) && fields.eligibleDebtIds.length > 0 &&
      Number.isFinite(fields.standardApr) && fields.standardApr >= 0 &&
      Number.isFinite(fields.promoMonths) && fields.promoMonths >= 0 &&
      Number.isFinite(fields.promoApr) && fields.promoApr >= 0 &&
      Number.isFinite(fields.feePercent) && fields.feePercent >= 0,
    );
  }
  return false;
}

/** "£100" → 10000. Returns null for invalid. */
export function poundsInputToPennies(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** "21.9" → 0.219. Returns null for invalid. */
export function percentInputToDecimal(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n / 100;
}

/** "12" → 12. Returns null for invalid. */
export function intInput(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}
