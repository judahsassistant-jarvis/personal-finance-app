/**
 * Inspect: which UID(s) in the emulator own real data, and which is a stub?
 * Prints each user doc + count of docs in every user-scoped collection per UID.
 *
 * Usage:
 *   cd scripts
 *   node inspect-emulator-users.js
 *
 * Requires: emulator running on 127.0.0.1:8080.
 */

import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
admin.initializeApp({ projectId: 'personal-finance-app-dev-3ffb2' });
const db = admin.firestore();

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
  const usersSnap = await db.collection('users').get();
  console.log(`\nFound ${usersSnap.size} user doc(s) in emulator:\n`);

  for (const userDoc of usersSnap.docs) {
    const u = userDoc.data();
    console.log(`UID: ${userDoc.id}`);
    console.log(`  email: ${u.email ?? '(none)'}`);
    console.log(`  display_name: ${u.display_name ?? '(none)'}`);
    console.log(`  created: ${u.created?.toDate?.().toISOString?.() ?? u.created ?? '(none)'}`);
    console.log(`  pay_cycle: ${JSON.stringify(u.pay_cycle ?? null)}`);
    console.log(`  buffer_pennies: ${u.buffer_pennies ?? '(none)'}`);
    console.log(`  onboarding_complete: ${u.onboarding_complete ?? '(none)'}`);
    console.log(`  data ownership:`);
    for (const col of COLLECTIONS) {
      const snap = await db
        .collection(col)
        .where('user_id', '==', userDoc.id)
        .get();
      if (snap.size > 0) {
        console.log(`    ${col}: ${snap.size}`);
      }
    }
    console.log('');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
