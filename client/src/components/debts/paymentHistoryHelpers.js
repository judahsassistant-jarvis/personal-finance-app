/**
 * Merge a debt's tagged transactions + balance snapshots into a single
 * timeline sorted newest-first. Each row carries a `kind` discriminator so
 * the renderer can style payments and snapshots differently, plus the
 * original record on `data` for any detail access.
 *
 * Pure function — no dates parsed with timezones, no side effects.
 */

export function buildPaymentTimeline({ debtId, transactions, snapshots }) {
  const rows = [];

  for (const t of transactions || []) {
    if (t.debt_id !== debtId) continue;
    const ms = toMillis(t.date);
    if (!ms) continue;
    rows.push({
      id: `tx:${t.id}`,
      kind: 'payment',
      timestamp: ms,
      data: t,
    });
  }

  for (const s of snapshots || []) {
    if (s.debt_id !== debtId) continue;
    const ms = toMillis(s.as_of_date);
    if (!ms) continue;
    rows.push({
      id: `snap:${s.id}`,
      kind: 'snapshot',
      timestamp: ms,
      data: s,
    });
  }

  rows.sort((a, b) => b.timestamp - a.timestamp);
  return rows;
}

/**
 * Summary numbers for the panel header: total payments made, total payment
 * amount, snapshot count, first snapshot balance. All returned even when the
 * lists are empty so the renderer doesn't need to null-check.
 */
export function summarisePaymentTimeline(timeline) {
  let paymentCount = 0;
  let paymentPennies = 0;
  let snapshotCount = 0;
  let oldestSnapshotBalance = null;
  let newestSnapshotBalance = null;

  // Rows are sorted newest-first — track oldest via last-write-wins as we iterate.
  for (const row of timeline) {
    if (row.kind === 'payment') {
      paymentCount += 1;
      paymentPennies += Math.abs(Number(row.data.amount_pennies || 0));
    } else if (row.kind === 'snapshot') {
      snapshotCount += 1;
      if (newestSnapshotBalance == null) newestSnapshotBalance = Number(row.data.balance_pennies || 0);
      oldestSnapshotBalance = Number(row.data.balance_pennies || 0);
    }
  }

  return {
    paymentCount,
    paymentPennies,
    snapshotCount,
    oldestSnapshotBalance,
    newestSnapshotBalance,
  };
}

function toMillis(d) {
  if (!d) return 0;
  // serializeDoc converts Firestore Timestamps to epoch millis — this is the
  // usual shape after fetch. Check first so the fast path is one check.
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
