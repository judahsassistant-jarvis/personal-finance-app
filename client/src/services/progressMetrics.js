/**
 * Progress metrics for the Dashboard + Debt Planner progress cards.
 *
 * Pure functions — take already-fetched Redux state + a couple of forecast
 * results, return numbers the UI can render directly. The heavy lifting
 * (forecast computation) is done by the caller so the same two forecasts
 * can be shared with other cards on the page.
 */

import { CARD_LIKE_SUBTYPES } from '../firebase/schema.js';

/**
 * Aggregate "how much of your total plan is done?" — sum of (starting − current)
 * divided by sum of starting balances, across every debt where a starting
 * balance has been recorded. Card-like debts without a starting balance are
 * excluded (utilisation is the right lens for them); overdrafts without a
 * starting balance likewise.
 *
 * Returns null when no debt has enough info to contribute.
 */
export function computePercentPaidOff(debts, buckets) {
  let totalStarting = 0;
  let totalPaid = 0;
  for (const debt of debts || []) {
    const starting = Number(debt?.starting_balance_pennies ?? 0);
    if (!Number.isFinite(starting) || starting <= 0) continue;
    const current = currentDebtBalance(debt, buckets);
    const paid = Math.max(0, starting - current);
    totalStarting += starting;
    totalPaid += paid;
  }
  if (totalStarting === 0) return null;
  return {
    ratio: Math.min(1, totalPaid / totalStarting),
    paidPennies: totalPaid,
    startingPennies: totalStarting,
  };
}

/**
 * Consecutive calendar-month streak ending at `asOf` where the user made at
 * least one debt-tagged payment. The current month counts as in-progress if
 * it already has a payment; otherwise the streak runs up to last month.
 *
 * A gap of one calendar month with no debt payments breaks the streak.
 */
export function computePaymentStreak(transactions, asOf = new Date()) {
  const paidMonths = new Set();
  for (const t of transactions || []) {
    if (!t.debt_id) continue;
    const ms = toMillis(t.date);
    if (!ms) continue;
    const d = new Date(ms);
    paidMonths.add(monthKey(d));
  }
  if (paidMonths.size === 0) return 0;

  let streak = 0;
  const cursor = new Date(asOf);
  cursor.setDate(1);

  // If the current month hasn't been paid yet, start the scan from last month
  // — the streak shouldn't break just because it's the 3rd of the month.
  if (!paidMonths.has(monthKey(cursor))) {
    cursor.setMonth(cursor.getMonth() - 1);
  }

  while (paidMonths.has(monthKey(cursor))) {
    streak += 1;
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return streak;
}

/**
 * Per-debt spending-delta between the two most recent snapshots.
 *
 *   expected_balance_after_payments = prev_balance − payments_in_period
 *   new_charges = current_balance − expected_balance_after_payments
 *
 * Positive = new purchases / interest pushed the balance above what payments
 * alone would explain. Zero = payments cleared exactly what was outstanding.
 * Negative = a refund / credit / interest reversal came in on top of your
 * payments. Null when there are fewer than two snapshots.
 *
 * Only the snapshot-to-snapshot period is considered — payments outside the
 * period are ignored.
 */
export function computeSpendingDelta(debtId, snapshots, transactions) {
  const forDebt = (snapshots || [])
    .filter((s) => s.debt_id === debtId)
    .map((s) => ({ ...s, ms: toMillis(s.as_of_date) }))
    .filter((s) => s.ms > 0)
    .sort((a, b) => b.ms - a.ms);
  if (forDebt.length < 2) return null;

  const [latest, previous] = forDebt;
  let paymentsInPeriod = 0;
  for (const t of transactions || []) {
    if (t.debt_id !== debtId) continue;
    const ms = toMillis(t.date);
    if (ms <= previous.ms || ms > latest.ms) continue;
    paymentsInPeriod += Math.abs(Number(t.amount_pennies || 0));
  }

  const prevBalance = Number(previous.balance_pennies || 0);
  const currBalance = Number(latest.balance_pennies || 0);
  const newCharges = currBalance - (prevBalance - paymentsInPeriod);

  return {
    newChargesPennies: newCharges,
    paymentsInPeriodPennies: paymentsInPeriod,
    prevBalancePennies: prevBalance,
    currentBalancePennies: currBalance,
    periodStart: previous.ms,
    periodEnd: latest.ms,
  };
}

/**
 * Bundle the lot into one object for the progress card. `baseline` and
 * `minOnly` are `runForecast` result objects (active strategy at effective
 * budget, and min-only mode respectively) — the caller computes them once
 * and shares across cards.
 */
export function computeProgressMetrics({
  debts, buckets, snapshots, transactions,
  baseline, minOnly,
  asOf = new Date(),
}) {
  const percentPaidOff = computePercentPaidOff(debts, buckets);
  const paymentStreak = computePaymentStreak(transactions, asOf);
  const interestSavedPennies = Math.max(
    0,
    Number(minOnly?.summary?.totalInterestPennies ?? 0)
      - Number(baseline?.summary?.totalInterestPennies ?? 0),
  );
  const spendingDeltas = new Map();
  for (const debt of debts || []) {
    const delta = computeSpendingDelta(debt.id, snapshots, transactions);
    if (delta) spendingDeltas.set(debt.id, delta);
  }
  return {
    debtFreeMonth: baseline?.debtFreeMonth ?? null,
    monthsToPayoff: baseline?.summary?.monthsToPayoff ?? 0,
    interestSavedPennies,
    percentPaidOff,
    paymentStreak,
    spendingDeltas,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentDebtBalance(debt, buckets) {
  if (CARD_LIKE_SUBTYPES.has(debt.subtype)) {
    return (buckets || [])
      .filter((b) => b.debt_id === debt.id)
      .reduce((s, b) => s + Math.max(0, Number(b.balance_pennies || 0)), 0);
  }
  return Math.max(0, Number(debt.balance_pennies || 0));
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function toMillis(d) {
  if (!d) return 0;
  if (typeof d === 'number') return Number.isFinite(d) ? d : 0;
  if (d instanceof Date) return d.getTime();
  if (typeof d === 'string') {
    const t = new Date(d).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof d.toDate === 'function') return d.toDate().getTime();
  if (typeof d.seconds === 'number') return d.seconds * 1000;
  return 0;
}
