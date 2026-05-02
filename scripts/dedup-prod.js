/**
 * One-shot dedup of personal-finance-app-prod, run after the
 * 2026-05-01 emulator→prod migration discovered Judah had been
 * entering the same data on both surfaces.
 *
 * Order matters: accounts → debts → card_buckets → transactions →
 * category_rules → debt_config. Earlier phases unify foreign-key
 * targets (account_id, debt_id) so later phases can dedup correctly.
 *
 * Default: dry-run all phases. Pass --execute to actually write.
 * Pass --phase=NAME to run a single phase. Combine flags freely.
 *
 * Usage:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "<prod-sa-key>.json"
 *   node dedup-prod.js                          # dry-run all phases
 *   node dedup-prod.js --phase=accounts         # dry-run accounts only
 *   node dedup-prod.js --phase=accounts --execute   # run accounts for real
 *   node dedup-prod.js --execute                # run every phase, in order
 */

import admin from 'firebase-admin';

delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

const EXECUTE = process.argv.includes('--execute');
const PHASE_FLAG = process.argv.find((a) => a.startsWith('--phase='));
const ONLY_PHASE = PHASE_FLAG ? PHASE_FLAG.split('=')[1] : null;
const USER_EMAIL = 'judahsassistant@gmail.com';
const PROD_PROJECT = 'personal-finance-app-prod';

admin.initializeApp({ projectId: PROD_PROJECT });
const db = admin.firestore();
const auth = admin.auth();

const PHASES = [
  'accounts',
  'debts',
  'card_buckets',
  'transactions',
  'category_rules',
  'debt_config',
];

// Per-collection name aliases used when grouping duplicates. Lets us treat
// "Virgin Money" and "Virgin Atlantic" as the same logical debt for Judah's
// 2026-05-01 dedup, without changing how the matcher works for other names.
const NAME_ALIASES = {
  debts: {
    'virgin money': 'virgin',
    'virgin atlantic': 'virgin',
  },
};

function aliasedName(collection, name) {
  const map = NAME_ALIASES[collection];
  const k = String(name ?? '').trim().toLowerCase();
  return map?.[k] ?? k;
}

function log(...args) { console.log(...args); }
function norm(s) { return String(s ?? '').trim().toLowerCase(); }
function tsMs(v) {
  // Handle Firestore Timestamp, Date, or epoch number.
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  return 0;
}

async function commitInBatches(ops, label) {
  // ops: array of (batch) => void. Each runs one Firestore write.
  if (ops.length === 0) return;
  const MAX = 400;
  for (let i = 0; i < ops.length; i += MAX) {
    const slice = ops.slice(i, i + MAX);
    const batch = db.batch();
    for (const op of slice) op(batch);
    if (EXECUTE) await batch.commit();
  }
  log(`  ${EXECUTE ? 'wrote' : 'would write'} ${ops.length} ${label} op(s)`);
}

// ---------------------------------------------------------------------------
// Phase: accounts
// ---------------------------------------------------------------------------
async function phaseAccounts(uid) {
  log('\n=== Phase: accounts ===');
  const snap = await db.collection('accounts').where('user_id', '==', uid).get();
  log(`  ${snap.size} account(s) found.`);

  // Group by (aliased name, subtype).
  const groups = new Map();
  for (const d of snap.docs) {
    const data = d.data();
    const key = `${aliasedName('accounts', data.name)}|${norm(data.subtype)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: d.id, ...data });
  }

  let dupGroups = 0;
  const ops = [];
  const txOps = [];

  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    dupGroups++;
    // Keep newest (Apr 30 prod-origin per 2026-05-01 dedup decision).
    members.sort((a, b) => tsMs(b.created) - tsMs(a.created));
    const canonical = members[0];
    const dups = members.slice(1);
    log(`  group "${key}": keep ${canonical.id} (newest), drop ${dups.map((d) => d.id).join(', ')}`);

    for (const dup of dups) {
      const txSnap = await db.collection('transactions')
        .where('user_id', '==', uid)
        .where('account_id', '==', dup.id)
        .get();
      log(`    rewriting ${txSnap.size} tx(s) from account_id ${dup.id} → ${canonical.id}`);
      for (const txDoc of txSnap.docs) {
        txOps.push((b) => b.update(txDoc.ref, { account_id: canonical.id }));
      }
      ops.push((b) => b.delete(db.collection('accounts').doc(dup.id)));
    }
  }

  if (dupGroups === 0) {
    log('  no duplicate accounts.');
    return;
  }
  await commitInBatches(txOps, 'transaction reassign');
  await commitInBatches(ops, 'account delete');
}

// ---------------------------------------------------------------------------
// Phase: debts
// ---------------------------------------------------------------------------
async function phaseDebts(uid) {
  log('\n=== Phase: debts ===');
  const snap = await db.collection('debts').where('user_id', '==', uid).get();
  log(`  ${snap.size} debt(s) found.`);

  const groups = new Map();
  for (const d of snap.docs) {
    const data = d.data();
    const key = `${aliasedName('debts', data.name)}|${norm(data.subtype)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: d.id, ...data });
  }

  let dupGroups = 0;
  const cbOps = [];
  const bsOps = [];
  const txOps = [];
  const debtOps = [];

  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    dupGroups++;
    // Keep newest (Apr 30 prod-origin).
    members.sort((a, b) => tsMs(b.created) - tsMs(a.created));
    const canonical = members[0];
    const dups = members.slice(1);
    log(`  group "${key}": keep ${canonical.id} (newest), drop ${dups.map((d) => d.id).join(', ')}`);

    for (const dup of dups) {
      const cbSnap = await db.collection('card_buckets')
        .where('user_id', '==', uid)
        .where('debt_id', '==', dup.id)
        .get();
      const bsSnap = await db.collection('balance_snapshots')
        .where('user_id', '==', uid)
        .where('debt_id', '==', dup.id)
        .get();
      const txSnap = await db.collection('transactions')
        .where('user_id', '==', uid)
        .where('debt_id', '==', dup.id)
        .get();
      log(`    rewriting refs: ${cbSnap.size} card_bucket(s), ${bsSnap.size} snapshot(s), ${txSnap.size} tx(s)`);
      for (const x of cbSnap.docs) cbOps.push((b) => b.update(x.ref, { debt_id: canonical.id }));
      for (const x of bsSnap.docs) bsOps.push((b) => b.update(x.ref, { debt_id: canonical.id }));
      for (const x of txSnap.docs) txOps.push((b) => b.update(x.ref, { debt_id: canonical.id }));
      debtOps.push((b) => b.delete(db.collection('debts').doc(dup.id)));
    }
  }

  if (dupGroups === 0) {
    log('  no duplicate debts.');
    return;
  }
  await commitInBatches(cbOps, 'card_bucket reassign');
  await commitInBatches(bsOps, 'snapshot reassign');
  await commitInBatches(txOps, 'transaction reassign');
  await commitInBatches(debtOps, 'debt delete');
}

// ---------------------------------------------------------------------------
// Phase: card_buckets
// ---------------------------------------------------------------------------
async function phaseCardBuckets(uid) {
  log('\n=== Phase: card_buckets ===');
  const snap = await db.collection('card_buckets').where('user_id', '==', uid).get();
  log(`  ${snap.size} card_bucket(s) found.`);

  const groups = new Map();
  for (const d of snap.docs) {
    const data = d.data();
    const key = `${data.debt_id}|${norm(data.name)}|${data.apr}|${data.is_promo}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: d.id, ...data });
  }

  const ops = [];
  let dupGroups = 0;
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    dupGroups++;
    // Keep newest (Apr 30 prod-origin).
    members.sort((a, b) => tsMs(b.created) - tsMs(a.created));
    const dups = members.slice(1);
    log(`  group "${key}": keep ${members[0].id} (newest), drop ${dups.map((d) => d.id).join(', ')}`);
    for (const dup of dups) ops.push((b) => b.delete(db.collection('card_buckets').doc(dup.id)));
  }

  if (dupGroups === 0) {
    log('  no duplicate card_buckets.');
    return;
  }
  await commitInBatches(ops, 'card_bucket delete');
}

// ---------------------------------------------------------------------------
// Phase: transactions
// ---------------------------------------------------------------------------
async function phaseTransactions(uid) {
  log('\n=== Phase: transactions ===');
  const snap = await db.collection('transactions').where('user_id', '==', uid).get();
  log(`  ${snap.size} transaction(s) found.`);

  const groups = new Map();
  for (const d of snap.docs) {
    const data = d.data();
    const dateMs = tsMs(data.date);
    const key = [
      data.account_id,
      dateMs,
      data.amount_pennies,
      norm(data.merchant),
      norm(data.description),
    ].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: d.id, ...data });
  }

  const ops = [];
  let dupGroups = 0;
  let dupDocs = 0;
  for (const [_key, members] of groups) {
    if (members.length < 2) continue;
    dupGroups++;
    // Prefer the one with a category != 'Other' (manually curated) over a default 'Other'.
    // Tiebreak: prefer newest (Apr 30 prod-origin per dedup decision).
    members.sort((a, b) => {
      const aCustom = norm(a.category) !== 'other' ? 0 : 1;
      const bCustom = norm(b.category) !== 'other' ? 0 : 1;
      if (aCustom !== bCustom) return aCustom - bCustom;
      return tsMs(b.created) - tsMs(a.created);
    });
    const dups = members.slice(1);
    dupDocs += dups.length;
    for (const dup of dups) ops.push((b) => b.delete(db.collection('transactions').doc(dup.id)));
  }
  log(`  ${dupGroups} duplicate group(s), ${dupDocs} doc(s) to delete.`);
  if (dupGroups === 0) return;
  await commitInBatches(ops, 'transaction delete');
}

// ---------------------------------------------------------------------------
// Phase: category_rules
// ---------------------------------------------------------------------------
async function phaseCategoryRules(uid) {
  log('\n=== Phase: category_rules ===');
  const snap = await db.collection('category_rules').where('user_id', '==', uid).get();
  log(`  ${snap.size} category_rule(s) found.`);

  const groups = new Map();
  for (const d of snap.docs) {
    const data = d.data();
    const key = `${norm(data.merchant)}|${norm(data.category)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: d.id, ...data });
  }

  const ops = [];
  let dupGroups = 0;
  for (const [_key, members] of groups) {
    if (members.length < 2) continue;
    dupGroups++;
    // Keep newest.
    members.sort((a, b) => tsMs(b.created) - tsMs(a.created));
    const dups = members.slice(1);
    for (const dup of dups) ops.push((b) => b.delete(db.collection('category_rules').doc(dup.id)));
  }
  log(`  ${dupGroups} duplicate group(s), ${ops.length} doc(s) to delete.`);
  if (ops.length === 0) return;
  await commitInBatches(ops, 'category_rule delete');
}

// ---------------------------------------------------------------------------
// Phase: debt_config (schema bug — should be one per user)
// ---------------------------------------------------------------------------
async function phaseDebtConfig(uid) {
  log('\n=== Phase: debt_config ===');
  const snap = await db.collection('debt_config').where('user_id', '==', uid).get();
  log(`  ${snap.size} debt_config doc(s) found (schema expects 1).`);
  if (snap.size <= 1) return;

  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  // Keep the most recently created (assumes recent edits replace older defaults).
  all.sort((a, b) => tsMs(b.created) - tsMs(a.created));
  const keep = all[0];
  const dups = all.slice(1);
  log(`  keep ${keep.id} (most recent), delete ${dups.length} older.`);

  const ops = dups.map((dup) => (b) => b.delete(db.collection('debt_config').doc(dup.id)));
  await commitInBatches(ops, 'debt_config delete');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const user = await auth.getUserByEmail(USER_EMAIL);
  log(`\n=== PFA prod dedup ===`);
  log(`UID: ${user.uid}`);
  log(`Mode: ${EXECUTE ? 'EXECUTE (writes will happen)' : 'DRY RUN (no writes)'}`);
  log(`Phases: ${ONLY_PHASE ?? PHASES.join(', ')}`);

  const phaseFns = {
    accounts: phaseAccounts,
    debts: phaseDebts,
    card_buckets: phaseCardBuckets,
    transactions: phaseTransactions,
    category_rules: phaseCategoryRules,
    debt_config: phaseDebtConfig,
  };

  const toRun = ONLY_PHASE ? [ONLY_PHASE] : PHASES;
  for (const p of toRun) {
    if (!phaseFns[p]) {
      console.error(`Unknown phase: ${p}`);
      process.exit(1);
    }
    await phaseFns[p](user.uid);
  }

  log(`\nDone. ${EXECUTE ? 'Reload the app to verify.' : 'Re-run with --execute to apply.'}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
