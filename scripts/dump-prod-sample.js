/**
 * Dump a few sample docs from prod to verify field shapes are correct.
 * Specifically: user_id must be a string equal to the prod UID, not a
 * Firestore Reference, undefined, or some other type.
 *
 * Usage:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "<prod-sa-key.json>"
 *   node dump-prod-sample.js
 */

import admin from 'firebase-admin';

delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

admin.initializeApp({ projectId: 'personal-finance-app-prod' });
const db = admin.firestore();
const auth = admin.auth();

async function main() {
  const user = await auth.getUserByEmail('judahsassistant@gmail.com');
  console.log(`Prod UID: ${user.uid}\n`);

  const accountsSnap = await db.collection('accounts').limit(3).get();
  console.log(`=== sample accounts (${accountsSnap.size}) ===`);
  for (const d of accountsSnap.docs) {
    const data = d.data();
    console.log(`\nid: ${d.id}`);
    console.log(`  user_id: ${JSON.stringify(data.user_id)} (type=${typeof data.user_id})`);
    console.log(`  user_id matches prod UID? ${data.user_id === user.uid}`);
    console.log(`  name: ${JSON.stringify(data.name)}`);
    console.log(`  subtype: ${data.subtype}`);
    console.log(`  balance_pennies: ${data.balance_pennies}`);
    console.log(`  liquidity: ${data.liquidity}`);
    console.log(`  include_in_safe_to_spend: ${data.include_in_safe_to_spend}`);
    console.log(`  all keys: ${Object.keys(data).join(', ')}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
