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
const AMOUNT_TOLERANCE = 0.05; // ±5%

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

  // Filter: outflows in the lookback window.
  const inWindow = transactions.filter((t) => {
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
    if (txs.length < 2) continue;

    // Collapse amount variance: group by rounded amount, pick the most common group.
    const amountGroups = new Map();
    for (const t of txs) {
      const amt = Math.abs(Number(t.amount_pennies || 0));
      // Bucket by ±5% tolerance — canonical amount is the group's first tx amount.
      let bucketKey = null;
      for (const key of amountGroups.keys()) {
        if (Math.abs(key - amt) <= Math.max(key, amt) * AMOUNT_TOLERANCE) {
          bucketKey = key;
          break;
        }
      }
      if (bucketKey == null) bucketKey = amt;
      if (!amountGroups.has(bucketKey)) amountGroups.set(bucketKey, []);
      amountGroups.get(bucketKey).push(t);
    }

    // Must have a dominant amount group with 2+ occurrences.
    const dominant = [...amountGroups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (!dominant || dominant[1].length < 2) continue;
    const [expectedAmount, dominantTxs] = dominant;

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
    const tol = Math.max(amt, expected) * AMOUNT_TOLERANCE;
    return Math.abs(amt - expected) <= tol;
  });
  if (match) return 'paid';

  // Compute expected date within this cycle.
  const expectedThisCycle = new Date(cycleStart);
  expectedThisCycle.setDate(bill.expected_day_of_month);
  if (expectedThisCycle < cycleStart) expectedThisCycle.setMonth(expectedThisCycle.getMonth() + 1);

  return now >= expectedThisCycle ? 'missed' : 'upcoming';
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
