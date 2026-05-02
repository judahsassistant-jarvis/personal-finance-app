/**
 * Print every account and every debt under Judah's prod UID with enough
 * detail to pick the canonical version of each duplicate pair.
 *
 * Usage:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "<prod-sa-key>.json"
 *   node inspect-duplicates.js
 */

import admin from 'firebase-admin';

delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

admin.initializeApp({ projectId: 'personal-finance-app-prod' });
const db = admin.firestore();
const auth = admin.auth();

function fmtTs(v) {
  if (!v) return '(no created)';
  if (typeof v.toDate === 'function') return v.toDate().toISOString().slice(0, 19);
  if (typeof v.toMillis === 'function') return new Date(v.toMillis()).toISOString().slice(0, 19);
  return String(v);
}
function fmtGBP(p) {
  if (p == null) return '(none)';
  return `£${(Number(p) / 100).toFixed(2)}`;
}

async function main() {
  const user = await auth.getUserByEmail('judahsassistant@gmail.com');
  const uid = user.uid;

  // ---------- accounts ----------
  console.log('\n================ ACCOUNTS ================\n');
  const accSnap = await db.collection('accounts').where('user_id', '==', uid).get();
  const accounts = accSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  accounts.sort((a, b) => `${a.name}|${a.subtype}`.localeCompare(`${b.name}|${b.subtype}`));

  for (const a of accounts) {
    const txCount = (await db.collection('transactions')
      .where('user_id', '==', uid)
      .where('account_id', '==', a.id)
      .get()).size;
    console.log(`  id:           ${a.id}`);
    console.log(`  name:         ${a.name}`);
    console.log(`  subtype:      ${a.subtype}`);
    console.log(`  balance:      ${fmtGBP(a.balance_pennies)}`);
    console.log(`  in_safe2spd:  ${a.include_in_safe_to_spend}`);
    console.log(`  liquidity:    ${a.liquidity}`);
    console.log(`  created:      ${fmtTs(a.created)}`);
    console.log(`  tx linked:    ${txCount}`);
    console.log('');
  }

  // ---------- debts ----------
  console.log('\n================ DEBTS ================\n');
  const debtSnap = await db.collection('debts').where('user_id', '==', uid).get();
  const debts = debtSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  debts.sort((a, b) => `${a.name}|${a.subtype}`.localeCompare(`${b.name}|${b.subtype}`));

  for (const d of debts) {
    const cbCount = (await db.collection('card_buckets')
      .where('user_id', '==', uid)
      .where('debt_id', '==', d.id)
      .get()).size;
    const txCount = (await db.collection('transactions')
      .where('user_id', '==', uid)
      .where('debt_id', '==', d.id)
      .get()).size;
    console.log(`  id:           ${d.id}`);
    console.log(`  name:         ${d.name}`);
    console.log(`  subtype:      ${d.subtype}`);
    console.log(`  balance:      ${fmtGBP(d.balance_pennies)}`);
    console.log(`  std APR:      ${d.standard_apr ?? '(none)'}`);
    console.log(`  limit:        ${fmtGBP(d.limit_pennies)}`);
    console.log(`  created:      ${fmtTs(d.created)}`);
    console.log(`  card_buckets: ${cbCount}`);
    console.log(`  tx linked:    ${txCount}`);
    console.log('');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
