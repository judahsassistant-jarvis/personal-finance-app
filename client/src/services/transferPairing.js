/**
 * Cross-account transfer pair detection.
 *
 * A transfer between two of the user's own accounts arrives as two unrelated
 * transactions: an outflow on Account A and an inflow on Account B. This
 * service identifies candidate pairs so the UI can prompt the user to
 * confirm them — once confirmed, both rows get a shared `transfer_pair_id`
 * and category `Transfer`, excluding them from spending/income totals.
 *
 * Pairing rule (audit §2):
 *   - One side outflow, the other inflow
 *   - Same |amount_pennies|, non-zero
 *   - Date within ±N calendar days (default 3)
 *   - Different account_id
 *   - Both rows currently unpaired AND not dismissed AND not debt-tagged
 *   - One-to-one match: only suggested if EXACTLY one candidate exists on
 *     each side. If multiple candidates exist (ambiguous), suppress rather
 *     than guess — the user can always tag manually via the Transfer
 *     category.
 *
 * Pure function. No IO, no Firestore. Caller (Transactions page) memoises
 * over the loaded transactions list and surfaces results in the UI.
 */

const DEFAULT_DATE_WINDOW_DAYS = 3;

/**
 * @param {Array} transactions - TransactionDoc[] with `id` set
 * @param {Object} [opts]
 * @param {number} [opts.dateWindowDays=3]
 * @returns {Array<{outflowId: string, inflowId: string, outflowAccountId: string, inflowAccountId: string, amount_pennies: number}>}
 */
export function findTransferPairs(transactions, opts = {}) {
  const dateWindowDays = opts.dateWindowDays ?? DEFAULT_DATE_WINDOW_DAYS;
  const windowMs = dateWindowDays * 24 * 60 * 60 * 1000;

  // Filter to eligible rows: not already paired, not dismissed, not debt-tagged.
  const eligible = (transactions || []).filter(isEligible);

  // Bucket by absolute amount.
  const byAmount = new Map();
  for (const t of eligible) {
    const amt = Math.abs(Number(t.amount_pennies || 0));
    if (amt === 0) continue;
    if (!byAmount.has(amt)) byAmount.set(amt, []);
    byAmount.get(amt).push(t);
  }

  const pairs = [];
  for (const [amt, txs] of byAmount.entries()) {
    const outflows = txs.filter((t) => Number(t.amount_pennies) < 0);
    const inflows = txs.filter((t) => Number(t.amount_pennies) > 0);
    if (outflows.length === 0 || inflows.length === 0) continue;

    for (const o of outflows) {
      const oMs = toMillis(o.date);
      if (oMs == null) continue;

      // Inflow candidates: different account, within date window.
      const candidates = inflows.filter((i) => {
        if (i.account_id === o.account_id) return false;
        const iMs = toMillis(i.date);
        return iMs != null && Math.abs(iMs - oMs) <= windowMs;
      });
      if (candidates.length !== 1) continue;
      const matchedInflow = candidates[0];

      // Bidirectional one-to-one: this inflow's only outflow candidate must
      // also be `o`. Otherwise the inflow is ambiguous from the other side
      // and we'd be over-confidently pairing.
      const reverseCandidates = outflows.filter((o2) => {
        if (o2.account_id === matchedInflow.account_id) return false;
        const o2Ms = toMillis(o2.date);
        const iMs = toMillis(matchedInflow.date);
        return o2Ms != null && iMs != null && Math.abs(iMs - o2Ms) <= windowMs;
      });
      if (reverseCandidates.length !== 1 || reverseCandidates[0] !== o) continue;

      pairs.push({
        outflowId: o.id,
        inflowId: matchedInflow.id,
        outflowAccountId: o.account_id,
        inflowAccountId: matchedInflow.account_id,
        amount_pennies: amt,
      });
    }
  }

  return pairs;
}

/**
 * Map of transaction id → pair summary for the row that involves it. Convenience
 * for UI lookup.
 *
 * @param {Array} pairs - findTransferPairs() output
 * @returns {Map<string, {pair: Object, role: 'outflow' | 'inflow', otherId: string, otherAccountId: string}>}
 */
export function indexPairsByTransaction(pairs) {
  const out = new Map();
  for (const p of pairs) {
    out.set(p.outflowId, {
      pair: p,
      role: 'outflow',
      otherId: p.inflowId,
      otherAccountId: p.inflowAccountId,
    });
    out.set(p.inflowId, {
      pair: p,
      role: 'inflow',
      otherId: p.outflowId,
      otherAccountId: p.outflowAccountId,
    });
  }
  return out;
}

/**
 * Deterministic pair id from the two transaction ids. Order-invariant — both
 * sides agree on the same id without needing a lookup.
 */
export function pairIdFor(txIdA, txIdB) {
  return [txIdA, txIdB].sort().join('|');
}

function isEligible(t) {
  if (!t) return false;
  if (t.transfer_pair_id) return false;
  if (t.pair_dismissed_at) return false;
  if (t.debt_id) return false;
  return true;
}

function toMillis(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const d = new Date(v);
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof v.toDate === 'function') {
    try {
      return v.toDate().getTime();
    } catch (_) {
      return null;
    }
  }
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return null;
}
