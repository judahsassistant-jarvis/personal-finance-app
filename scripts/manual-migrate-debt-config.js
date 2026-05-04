/**
 * Manual one-shot: migrate debt_config from its legacy random doc id
 * to the new {uid}-keyed convention. Used 2026-05-02 because the
 * client-side self-heal in debtConfigSlice.js didn't fire (likely
 * CDN caching / stale bundle); easier to do it admin-side than wait.
 */

import admin from 'firebase-admin';

delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

admin.initializeApp({ projectId: 'personal-finance-app-prod' });
const db = admin.firestore();
const auth = admin.auth();

async function main() {
  const user = await auth.getUserByEmail('judahsassistant@gmail.com');
  const uid = user.uid;

  const snap = await db.collection('debt_config').get();
  const all = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  const mine = all.filter((d) => d.data.user_id === uid);

  if (mine.length === 0) {
    console.log('No debt_config docs for this user. Nothing to do.');
    return;
  }

  const canonicalDoc = mine.find((d) => d.id === uid);
  if (canonicalDoc) {
    console.log(`Already migrated. Doc at debt_config/${uid} exists.`);
    // Clean up any stragglers with random IDs.
    const stragglers = mine.filter((d) => d.id !== uid);
    for (const s of stragglers) {
      console.log(`  deleting straggler: ${s.id}`);
      await db.collection('debt_config').doc(s.id).delete();
    }
    return;
  }

  // Pick the most recently created legacy doc as the source of truth.
  mine.sort((a, b) => {
    const ta = a.data.created?.toMillis?.() ?? 0;
    const tb = b.data.created?.toMillis?.() ?? 0;
    return tb - ta;
  });
  const source = mine[0];
  console.log(`Migrating debt_config/${source.id} → debt_config/${uid}`);
  console.log(`  source data:`, JSON.stringify(source.data, null, 2));

  await db.collection('debt_config').doc(uid).set(source.data);
  console.log(`  wrote canonical doc.`);

  for (const old of mine) {
    console.log(`  deleting legacy: ${old.id}`);
    await db.collection('debt_config').doc(old.id).delete();
  }

  console.log('\nDone. Reload the app.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
