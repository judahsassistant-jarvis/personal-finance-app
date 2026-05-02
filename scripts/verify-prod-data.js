/**
 * Verify: did the migration writes land in prod? Connects ONLY to prod
 * (no emulator anywhere) and counts docs under Judah's prod UID.
 *
 * Usage:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "<path-to-prod-sa-key>.json"
 *   node verify-prod-data.js
 */

import admin from 'firebase-admin';

// Make absolutely sure no emulator env vars are set before we touch the SDK.
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

admin.initializeApp({ projectId: 'personal-finance-app-prod' });
const db = admin.firestore();
const auth = admin.auth();

const COLLECTIONS = [
  'accounts',
  'debts',
  'card_buckets',
  'transactions',
  'import_batches',
  'balance_snapshots',
  'recurring_bills',
  'monthly_budgets',
  'debt_config',
  'forecast_snapshots',
  'audit_log',
  'category_rules',
];

async function main() {
  const user = await auth.getUserByEmail('judahsassistant@gmail.com');
  console.log(`\nProd UID: ${user.uid}`);
  console.log(`Project: personal-finance-app-prod\n`);

  let total = 0;
  for (const col of COLLECTIONS) {
    const snap = await db.collection(col).where('user_id', '==', user.uid).get();
    const all = await db.collection(col).get();
    console.log(`${col.padEnd(22)} | mine: ${String(snap.size).padStart(4)} | total in collection: ${all.size}`);
    total += snap.size;
  }
  console.log(`\nTotal docs owned by ${user.uid}: ${total}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
