/**
 * One-shot back-fill: stamp `dedup_key` on existing transactions imported
 * before audit Gap 1 shipped. Without this, the first re-import after the
 * upgrade wouldn't detect any existing rows as duplicates and would silently
 * double-up everything in the overlap window.
 *
 * Idempotent: skips rows that already have a dedup_key. Safe to re-run.
 *
 * Run with: npm run backfill-dedup-key  (from scripts/ dir)
 * Requires: emulators running.
 */

import admin from 'firebase-admin';
import { computeDedupKey } from '../client/src/services/csvParser.js';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST not set. Run via `npm run backfill-dedup-key`.');
  process.exit(1);
}

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

function toIsoDate(v) {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') return v.slice(0, 10);
  if (typeof v.toDate === 'function') return v.toDate().toISOString().slice(0, 10);
  if (typeof v.seconds === 'number') return new Date(v.seconds * 1000).toISOString().slice(0, 10);
  return '';
}

async function run() {
  const snap = await db.collection('transactions').get();
  if (snap.empty) {
    console.log('No transactions found. Nothing to do.');
    return;
  }

  let inspected = 0;
  let stamped = 0;
  let alreadyStamped = 0;
  let skipped = 0;
  const pendingUpdates = [];

  for (const doc of snap.docs) {
    inspected += 1;
    const data = doc.data();
    if (data.dedup_key) {
      alreadyStamped += 1;
      continue;
    }
    // Manual additions don't carry a description and never need dedup-checking
    // (nothing else would re-create them). Skip rather than stamping a key
    // derived from incomplete data.
    if (!data.description || !data.account_id || !data.date) {
      skipped += 1;
      continue;
    }
    const isoDate = toIsoDate(data.date);
    const amountPennies = Number(data.amount_pennies || 0) | 0;
    const key = computeDedupKey(data.account_id, isoDate, amountPennies, data.description);
    pendingUpdates.push({ ref: doc.ref, update: { dedup_key: key } });
    stamped += 1;
  }

  for (let i = 0; i < pendingUpdates.length; i += 500) {
    const batch = db.batch();
    for (const { ref, update } of pendingUpdates.slice(i, i + 500)) batch.update(ref, update);
    await batch.commit();
  }

  console.log(`Inspected:        ${inspected}`);
  console.log(`Stamped:          ${stamped}`);
  console.log(`Already stamped:  ${alreadyStamped}`);
  console.log(`Skipped (no description / account / date): ${skipped}`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
