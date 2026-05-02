/**
 * One-shot migration: lift Judah's emulator-resident dogfood data into the
 * personal-finance-app-prod Firestore.
 *
 * Background: prod went live 2026-04-26 but the local `npm run dev` loop
 * still pointed at the emulator (--import=./dev-data --export-on-exit=./dev-data).
 * Real-data dogfood between Apr 26 and Apr 27 went into the emulator export,
 * not prod. Discovered 2026-05-01 when the prod URL appeared empty.
 *
 * What this does:
 *   1. Connects to a running emulator (read-only) AND to prod (read+write).
 *   2. Looks up Judah's prod UID by email.
 *   3. For every user-scoped collection, copies docs from emulator → prod,
 *      rewriting the `user_id` field from the emulator UID to the prod UID.
 *      Doc IDs are preserved so cross-doc references (transactions.account_id,
 *      card_buckets.debt_id, transactions.debt_id, etc.) stay valid.
 *   4. Skips writes when the doc ID already exists in prod — protects whatever
 *      Judah entered directly on the prod URL since Apr 27.
 *   5. Skips collections that prod already owns or that admin-SDK populates
 *      (users, mail, system, notification_log).
 *
 * Idempotent on re-run: existing prod docs are left alone.
 *
 * Prerequisites:
 *   1. Service account key for personal-finance-app-prod. Generate at:
 *        Firebase Console → Project Settings → Service Accounts → Generate
 *      Save it somewhere outside the repo (e.g. ~/.gcp/pfa-prod-sa.json) and
 *      export GOOGLE_APPLICATION_CREDENTIALS pointing at the file.
 *   2. Emulator running with the Apr 27 import:
 *        cd C:/Users/yehud/projects/personal-finance-app
 *        firebase emulators:start --only auth,firestore --import=./dev-data
 *      DO NOT pass --export-on-exit while migrating; we want the emulator data
 *      read-only and unchanged.
 *
 * Usage:
 *   cd scripts
 *   # Preview without writing:
 *   GOOGLE_APPLICATION_CREDENTIALS="C:/Users/yehud/Downloads/pfa-prod-sa.json" \
 *     node migrate-emulator-to-prod.js --dry-run
 *   # Execute:
 *   GOOGLE_APPLICATION_CREDENTIALS="C:/Users/yehud/Downloads/pfa-prod-sa.json" \
 *     node migrate-emulator-to-prod.js
 */

import admin from 'firebase-admin';

const EMULATOR_HOST = '127.0.0.1:8080';
const EMULATOR_PROJECT = 'personal-finance-app-dev-3ffb2';
const PROD_PROJECT = 'personal-finance-app-prod';
const USER_EMAIL = 'judahsassistant@gmail.com';

// User-scoped collections to migrate. Order matters only for readability —
// we don't have FK constraints in Firestore, so any order works.
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

// Skipped on purpose:
//   users            — prod has Judah's profile (payday, buffer, budget); preserve it.
//   mail             — admin-only queue, never user-written.
//   system           — admin-only (bank holidays cache).
//   notification_log — admin-only (Cloud Functions write notification history).

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force'); // overwrite prod docs even if ID exists
const EMULATOR_UID_OVERRIDE = (() => {
  const flag = process.argv.find((a) => a.startsWith('--emulator-uid='));
  return flag ? flag.split('=')[1] : null;
})();

function log(...args) {
  console.log(...args);
}

async function main() {
  log(`\n=== PFA emulator → prod migration ===`);
  log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (will write to prod)'}`);
  log(`Force overwrite: ${FORCE ? 'YES' : 'no (skip if doc id exists)'}`);

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !DRY_RUN) {
    console.error('\nERROR: GOOGLE_APPLICATION_CREDENTIALS is not set.');
    console.error('Set it to the path of your prod service account JSON.');
    process.exit(1);
  }

  // ---------- emulator connection (read-only intent) ----------
  process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
  const emulatorApp = admin.initializeApp(
    { projectId: EMULATOR_PROJECT },
    'emulator',
  );
  const emulatorDb = emulatorApp.firestore();

  // Quick sanity check: emulator reachable?
  try {
    await emulatorDb.collection('accounts').limit(1).get();
  } catch (e) {
    console.error(`\nERROR: cannot reach emulator at ${EMULATOR_HOST}.`);
    console.error('Start it with:  firebase emulators:start --only auth,firestore --import=./dev-data');
    console.error(e.message);
    process.exit(1);
  }

  // ---------- prod connection ----------
  // Switch off the emulator env var BEFORE initialising prod, otherwise the
  // admin SDK will route prod calls to the emulator too.
  delete process.env.FIRESTORE_EMULATOR_HOST;
  const prodApp = admin.initializeApp(
    { projectId: PROD_PROJECT },
    'prod',
  );
  const prodDb = prodApp.firestore();
  const prodAuth = prodApp.auth();

  // ---------- look up prod UID ----------
  let prodUser;
  try {
    prodUser = await prodAuth.getUserByEmail(USER_EMAIL);
  } catch (e) {
    console.error(`\nERROR: could not look up ${USER_EMAIL} in prod auth.`);
    console.error(e.message);
    process.exit(1);
  }
  const prodUid = prodUser.uid;
  log(`\nProd UID for ${USER_EMAIL}: ${prodUid}`);

  // ---------- resolve emulator UID ----------
  // Prefer explicit override (--emulator-uid=...). Otherwise auto-detect: read
  // users/{uid} docs from emulator and pick the unique one matching the email.
  let emulatorUid;
  if (EMULATOR_UID_OVERRIDE) {
    emulatorUid = EMULATOR_UID_OVERRIDE;
    log(`Emulator UID (from --emulator-uid flag): ${emulatorUid}`);
  } else {
    const emulatorUsersSnap = await emulatorDb.collection('users').get();
    const emulatorUserDocs = emulatorUsersSnap.docs.filter(
      (d) => d.data().email === USER_EMAIL,
    );
    if (emulatorUserDocs.length === 0) {
      console.error(`\nERROR: no user doc in emulator with email ${USER_EMAIL}.`);
      process.exit(1);
    }
    if (emulatorUserDocs.length > 1) {
      console.error(`\nERROR: ${emulatorUserDocs.length} user docs match ${USER_EMAIL} in emulator.`);
      console.error('Re-run with --emulator-uid=<uid> to disambiguate.');
      console.error('Use scripts/inspect-emulator-users.js to see which UID owns the real data.');
      process.exit(1);
    }
    emulatorUid = emulatorUserDocs[0].id;
    log(`Emulator UID for ${USER_EMAIL}: ${emulatorUid}`);
  }

  if (emulatorUid === prodUid) {
    log('\nUIDs match — no rewrite needed (unusual but harmless).');
  }

  // ---------- per-collection migration ----------
  const summary = [];

  for (const col of COLLECTIONS) {
    const emSnap = await emulatorDb
      .collection(col)
      .where('user_id', '==', emulatorUid)
      .get();

    if (emSnap.empty) {
      summary.push({ col, total: 0, written: 0, skipped: 0, collisions: 0 });
      log(`\n[${col}] empty in emulator — nothing to migrate.`);
      continue;
    }

    log(`\n[${col}] ${emSnap.size} doc(s) in emulator under ${emulatorUid}.`);

    let written = 0;
    let collisions = 0;

    // Firestore batch limit is 500; chunk writes.
    let batch = prodDb.batch();
    let batchCount = 0;
    const MAX_BATCH = 400; // a bit under the 500 cap for headroom

    async function flushBatch() {
      if (batchCount === 0) return;
      if (!DRY_RUN) {
        await batch.commit();
      }
      batch = prodDb.batch();
      batchCount = 0;
    }

    for (const doc of emSnap.docs) {
      const data = doc.data();
      const newData = { ...data, user_id: prodUid };
      const prodRef = prodDb.collection(col).doc(doc.id);

      // Skip if prod already has this exact doc id (unless --force).
      if (!FORCE) {
        const existing = await prodRef.get();
        if (existing.exists) {
          collisions++;
          log(`  skip ${col}/${doc.id} (already exists in prod)`);
          continue;
        }
      }

      batch.set(prodRef, newData);
      batchCount++;
      written++;

      if (batchCount >= MAX_BATCH) {
        await flushBatch();
      }
    }

    await flushBatch();

    summary.push({
      col,
      total: emSnap.size,
      written,
      skipped: emSnap.size - written - collisions,
      collisions,
    });
  }

  // ---------- summary ----------
  log('\n=== Migration summary ===');
  log('collection            | em total | written | collisions');
  log('----------------------|----------|---------|-----------');
  for (const r of summary) {
    log(
      `${r.col.padEnd(22)}|${String(r.total).padStart(9)} |${String(r.written).padStart(8)} |${String(r.collisions).padStart(10)}`,
    );
  }
  const totalWritten = summary.reduce((s, r) => s + r.written, 0);
  const totalCollisions = summary.reduce((s, r) => s + r.collisions, 0);
  log(`\nTotal written: ${totalWritten}    Total collisions: ${totalCollisions}`);

  if (DRY_RUN) {
    log('\nDRY RUN — nothing was written to prod. Re-run without --dry-run to execute.');
  } else {
    log('\nDONE. Reload https://personal-finance-app-prod.web.app and your data should be there.');
    log('If you see duplicates, the prod-side copies are anything you entered directly on');
    log('the prod URL after Apr 27 — delete them via the UI.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\nMIGRATION FAILED:', e);
    process.exit(1);
  });
