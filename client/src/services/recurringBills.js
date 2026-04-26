/**
 * Recurring-bill inference.
 *
 * Given a list of historical transactions, derive metadata about recurring
 * bills: expected day-of-month, typical amount, last-paid date, next expected
 * date. This populates the `recurring_bills` collection so the Dashboard can
 * show "remaining this cycle" without scanning all transactions every render.
 *
 * Heuristic: group outflow transactions by merchant. A merchant that has 2+
 * outflows in the lookback window with the same amount (±5%) is treated as
 * recurring; the modal day-of-month becomes the expected pay day.
 *
 * Also provides a helper to decide, for a given bill + current cycle, whether
 * it has been paid yet (matching transaction in window).
 */

const DEFAULT_LOOKBACK_MONTHS = 3;
// Two-tier amount tolerance. The tight tier covers fixed subscriptions (Netflix
// £13.99 every month). The loose tier covers variable bills like energy that
// genuinely swing month-to-month (£140 winter / £80 summer is ±27% — a
// meaningful pattern that ±5% would miss). We require more occurrences at the
// loose tier to compensate for the wider cluster window.
const AMOUNT_TOLERANCE_TIGHT = 0.05; // ±5%
const AMOUNT_TOLERANCE_LOOSE = 0.25; // ±25%
const MIN_OCCURRENCES_TIGHT = 2;
const MIN_OCCURRENCES_LOOSE = 3;
const NON_BILL_CATEGORIES = new Set(['Transfer', 'Investment', 'Payments', 'Debt Payment']);

/**
 * @param {Object} opts
 * @param {Array} opts.transactions - list of tx docs with { merchant, amount_pennies, date, category }
 * @param {Date}  [opts.asOf]      - reference date; defaults to now
 * @param {number} [opts.lookbackMonths]
 * @returns {Array<{merchant, category, expected_amount_pennies, expected_day_of_month, occurrences, last_paid, next_expected, auto_inferred}>}
 */
export function inferRecurringBills({
  transactions,
  asOf = new Date(),
  lookbackMonths = DEFAULT_LOOKBACK_MONTHS,
} = {}) {
  if (!Array.isArray(transactions)) return [];
  const windowStart = new Date(asOf);
  windowStart.setMonth(windowStart.getMonth() - lookbackMonths);

  // Filter: outflows in the lookback window. Debt-tagged transactions are
  // excluded — a debt payment lives in the debts collection as a fixed
  // minimum or similar; surfacing it here too would double-count in the
  // Dashboard's discretionary calc (§3.7 "Debts vs recurring_bills").
  // Transfer / Investment / Payments / Debt Payment categories are also
  // excluded: a monthly transfer to your ISA isn't a "bill", and surfacing
  // it would double-count balance-shifting outflows that the safe-to-spend
  // calc already handles via per-account opt-in.
  const inWindow = transactions.filter((t) => {
    if (t.debt_id) return false;
    if (NON_BILL_CATEGORIES.has(t.category)) return false;
    const d = toDate(t.date);
    if (!d) return false;
    return d >= windowStart && d <= asOf && Number(t.amount_pennies || 0) < 0;
  });

  // Group by merchant.
  const byMerchant = new Map();
  for (const t of inWindow) {
    const key = (t.merchant || '').toLowerCase();
    if (!key) continue;
    if (!byMerchant.has(key)) byMerchant.set(key, []);
    byMerchant.get(key).push(t);
  }

  const results = [];
  for (const [, txs] of byMerchant.entries()) {
    if (txs.length < MIN_OCCURRENCES_TIGHT) continue;

    // Try tight cluster first (covers fixed subscriptions). Fall back to
    // loose cluster (covers variable bills like energy). Loose requires more
    // occurrences to compensate for the wider window.
    const dominant =
      findAmountCluster(txs, AMOUNT_TOLERANCE_TIGHT, MIN_OCCURRENCES_TIGHT) ??
      findAmountCluster(txs, AMOUNT_TOLERANCE_LOOSE, MIN_OCCURRENCES_LOOSE);
    if (!dominant) continue;
    const { expectedAmount, dominantTxs } = dominant;

    // Modal day-of-month.
    const dayCounts = new Map();
    for (const t of dominantTxs) {
      const d = toDate(t.date);
      if (!d) continue;
      const day = d.getDate();
      dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
    }
    const expectedDay = [...dayCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

    // Last paid.
    const sortedByDate = [...dominantTxs].sort((a, b) => toDate(b.date) - toDate(a.date));
    const lastPaid = toDate(sortedByDate[0].date);

    // Next expected: the first day-of-month instance >= asOf.
    const next = new Date(asOf.getFullYear(), asOf.getMonth(), expectedDay);
    if (next < asOf) next.setMonth(next.getMonth() + 1);

    // Pick a category from the most recent tx in the dominant group.
    const category = sortedByDate[0].category || 'Bills';

    results.push({
      merchant: dominantTxs[0].merchant,
      category,
      expected_amount_pennies: Math.round(expectedAmount),
      expected_day_of_month: expectedDay,
      occurrences: dominantTxs.length,
      last_paid: lastPaid,
      next_expected: next,
      auto_inferred: true,
    });
  }

  return results.sort((a, b) => a.expected_day_of_month - b.expected_day_of_month);
}

/**
 * Find the largest cluster of transactions whose amounts agree within
 * `tolerance` of a candidate centre. Centre-pivot search rather than first-seen
 * bucketing — order-independent and avoids biasing the expected amount toward
 * whichever transaction happened to come first. Returns the cluster + its
 * median (the published `expected_amount_pennies`), or null if no cluster
 * meets `minCount`.
 */
function findAmountCluster(txs, tolerance, minCount) {
  if (!Array.isArray(txs) || txs.length < minCount) return null;
  const amounts = txs.map((t) => Math.abs(Number(t.amount_pennies || 0)));
  let best = null;
  for (let i = 0; i < amounts.length; i++) {
    const centre = amounts[i];
    if (centre === 0) continue;
    // Tolerance is applied against the LARGER of the two values being compared.
    // Symmetric — pairing a £110 candidate with a £140 centre gives the same
    // result as the reverse — and slightly more permissive than centre-only,
    // which is the right behaviour for variable bills with high-side outliers.
    const cluster = txs.filter((_, j) => Math.abs(amounts[j] - centre) <= Math.max(centre, amounts[j]) * tolerance);
    if (!best || cluster.length > best.cluster.length) {
      best = { cluster, centre };
    }
  }
  if (!best || best.cluster.length < minCount) return null;
  const sorted = best.cluster
    .map((t) => Math.abs(Number(t.amount_pennies || 0)))
    .sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { dominantTxs: best.cluster, expectedAmount: median };
}

/**
 * Compute the date a bill is expected to hit in the current cycle.
 * Returns a Date at midnight local time. Returns null if the bill's
 * day-of-month doesn't fall within the cycle (shouldn't happen for cycles
 * shorter than ~a month).
 */
export function billDateInCycle(bill, cycleStart, cycleEnd) {
  const day = Number(bill.expected_day_of_month || 0);
  if (!day) return null;
  // Try start month first, then end month.
  const candidates = [
    dayInMonth(cycleStart.getFullYear(), cycleStart.getMonth(), day),
    dayInMonth(cycleEnd.getFullYear(), cycleEnd.getMonth(), day),
  ];
  for (const d of candidates) {
    if (d >= cycleStart && d < cycleEnd) return d;
  }
  return null;
}

function dayInMonth(year, month, day) {
  const last = new Date(year, month + 1, 0).getDate();
  const clamped = Math.min(day, last);
  return new Date(year, month, clamped);
}

/**
 * For a given bill and the current cycle bounds, decide whether a matching
 * transaction has landed (the bill is "paid") or is still "upcoming".
 *
 * A transaction matches if:
 *   - merchant matches (case-insensitive, exact)
 *   - amount within ±5% of expected_amount_pennies
 *   - date is within [cycleStart, cycleEnd)
 *
 * @returns {'paid' | 'upcoming' | 'missed'}
 *   'paid' - matching tx in cycle
 *   'upcoming' - expected date hasn't arrived yet, no match
 *   'missed' - expected date has passed with no matching tx
 */
export function billStatusInCycle({ bill, transactions, cycleStart, cycleEnd, now = new Date() }) {
  const merchant = (bill.merchant || '').toLowerCase();
  const match = (transactions || []).some((t) => {
    if ((t.merchant || '').toLowerCase() !== merchant) return false;
    if (Number(t.amount_pennies || 0) >= 0) return false;
    const d = toDate(t.date);
    if (!d || d < cycleStart || d >= cycleEnd) return false;
    const amt = Math.abs(Number(t.amount_pennies || 0));
    const expected = Math.abs(Number(bill.expected_amount_pennies || 0));
    // Use loose tolerance here so a variable bill inferred at the loose tier
    // (e.g. £110 median energy with monthly swing) still matches its real
    // transactions (£140 winter, £80 summer) when checking "has this been
    // paid this cycle?" Tight tolerance here would reject the legitimate
    // match and surface false "missed" warnings.
    const tol = Math.max(amt, expected) * AMOUNT_TOLERANCE_LOOSE;
    return Math.abs(amt - expected) <= tol;
  });
  if (match) return 'paid';

  const expectedThisCycle = billDateInCycle(bill, cycleStart, cycleEnd);
  if (!expectedThisCycle) return 'upcoming';
  return now >= expectedThisCycle ? 'missed' : 'upcoming';
}

/**
 * Find a recurring_bills row whose merchant matches the given name (case-
 * insensitive exact match on the normalised string). Used by the "you just
 * tagged a transaction as a debt payment — remove its duplicate bill?"
 * prompt in the Transactions page. Returns the matching bill or null.
 */
export function findMatchingRecurringBill(merchant, bills) {
  if (!merchant) return null;
  const needle = String(merchant).toLowerCase().trim();
  if (!needle) return null;
  for (const b of bills || []) {
    if ((b.merchant || '').toLowerCase().trim() === needle) return b;
  }
  return null;
}

/**
 * Aggregate remaining-bills stats for the current cycle.
 * Returns counts + totals useful for the Dashboard hero row.
 */
export function remainingBillsInCycle({ bills, transactions, cycleStart, cycleEnd, now = new Date() }) {
  let pending = 0;
  let missed = 0;
  let pendingPennies = 0;
  let missedPennies = 0;
  for (const bill of bills || []) {
    const status = billStatusInCycle({ bill, transactions, cycleStart, cycleEnd, now });
    if (status === 'upcoming') {
      pending += 1;
      pendingPennies += Number(bill.expected_amount_pennies || 0);
    } else if (status === 'missed') {
      missed += 1;
      missedPennies += Number(bill.expected_amount_pennies || 0);
    }
  }
  return {
    pending_count: pending,
    missed_count: missed,
    pending_pennies: pendingPennies,
    missed_pennies: missedPennies,
    total_remaining_pennies: pendingPennies + missedPennies,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  if (v && typeof v.toDate === 'function') return v.toDate();
  if (v && typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  return null;
}
