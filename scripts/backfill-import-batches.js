/**
 * One-shot back-fill: reconstruct `import_batches` records from existing
 * transactions imported before audit Gap 4 shipped. Without this, the
 * Past-imports listing is empty until the user does a fresh import — they
 * lose visibility (and the undo affordance) over their historical data.
 *
 * Strategy: group transactions by `import_batch_id`. For each group, derive
 * a batch record with count + totals + earliest `created` as `imported_at`.
 * Statement metadata (#bank, #period_start, etc.) was never stored on the
 * historical transactions, so the reconstructed batches are minimal — the UI
 * marks them with a 'historical' badge so the user knows.
 *
 * Idempotent: skips creating a batch doc if one with the same id already
 * exists. Safe to re-run.
 *
 * Run with: npm run backfill-import-batches  (from scripts/ dir)
 * Requires: emulators running.
 */

import admin from 'firebase-admin';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST not set. Run via `npm run backfill-import-batches`.');
  process.exit(1);
}

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

async function run() {
  const txSnap = await db.collection('transactions').get();
  if (txSnap.empty) {
    console.log('No transactions found. Nothing to do.');
    return;
  }

  // Group by (user_id, import_batch_id). Skip rows with no batch id (manual
  // additions or pre-import-batch-id-tag legacy seeds).
  const groups = new Map();
  for (const doc of txSnap.docs) {
    const t = doc.data();
    const batchId = t.import_batch_id;
    if (!batchId || !t.user_id) continue;
    const key = `${t.user_id}|${batchId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        user_id: t.user_id,
        batchId,
        account_id: t.account_id,
        format: t.imported_from || 'unknown',
        rows: [],
      });
    }
    groups.get(key).rows.push(t);
  }

  // Find existing batch ids so we don't double-write.
  const batchSnap = await db.collection('import_batches').get();
  const existingIds = new Set(batchSnap.docs.map((d) => d.id));

  let created = 0;
  let alreadyExisted = 0;
  const writes = [];

  for (const group of groups.values()) {
    if (existingIds.has(group.batchId)) {
      alreadyExisted += 1;
      continue;
    }
    const totalDebit = group.rows
      .filter((t) => Number(t.amount_pennies || 0) < 0)
      .reduce((s, t) => s + Math.abs(Number(t.amount_pennies)), 0);
    const totalCredit = group.rows
      .filter((t) => Number(t.amount_pennies || 0) > 0)
      .reduce((s, t) => s + Number(t.amount_pennies), 0);
    // Use the earliest `created` timestamp on the group as imported_at —
    // closest available signal of when the batch landed.
    let earliestMs = Infinity;
    for (const r of group.rows) {
      const ms = r.created?.toMillis ? r.created.toMillis() : null;
      if (ms != null && ms < earliestMs) earliestMs = ms;
    }
    const importedAt = earliestMs === Infinity
      ? admin.firestore.FieldValue.serverTimestamp()
      : admin.firestore.Timestamp.fromMillis(earliestMs);
    writes.push({
      id: group.batchId,
      data: {
        user_id: group.user_id,
        account_id: group.account_id,
        count: group.rows.length,
        skipped: 0,
        total_debit_pennies: totalDebit,
        total_credit_pennies: totalCredit,
        format: group.format,
        imported_at: importedAt,
        historical: true,
        created: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
    created += 1;
  }

  for (let i = 0; i < writes.length; i += 500) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + 500)) {
      batch.set(db.collection('import_batches').doc(w.id), w.data);
    }
    await batch.commit();
  }

  console.log(`Groups inspected:  ${groups.size}`);
  console.log(`Batches created:   ${created}`);
  console.log(`Already existed:   ${alreadyExisted}`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
