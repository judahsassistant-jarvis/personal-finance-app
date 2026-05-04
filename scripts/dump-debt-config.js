/**
 * Dump every debt_config doc in prod with full field detail.
 * Used 2026-05-02 to debug why Strategy Comparison's controls are
 * greyed out (config null in Redux) post emulator-to-prod migration.
 */

import admin from 'firebase-admin';

delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

admin.initializeApp({ projectId: 'personal-finance-app-prod' });
const db = admin.firestore();
const auth = admin.auth();

async function main() {
  const user = await auth.getUserByEmail('judahsassistant@gmail.com');
  console.log(`\nProd UID: ${user.uid}\n`);

  const snap = await db.collection('debt_config').get();
  console.log(`Found ${snap.size} debt_config doc(s):\n`);

  for (const d of snap.docs) {
    const data = d.data();
    console.log(`id: ${d.id}`);
    console.log(`  matches uid? ${d.id === user.uid}`);
    for (const [k, v] of Object.entries(data)) {
      const out = typeof v?.toDate === 'function' ? v.toDate().toISOString()
        : typeof v?.toMillis === 'function' ? new Date(v.toMillis()).toISOString()
        : JSON.stringify(v);
      console.log(`  ${k}: ${out}`);
    }
    console.log('');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
