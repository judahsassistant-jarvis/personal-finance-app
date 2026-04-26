/**
 * One-shot back-fill: re-normalise PayPal-mediated transactions imported before
 * the parser learned the `PAYPAL *X` convention.
 *
 * Old behaviour: every `PAYPAL *<inner>` description collapsed to merchant
 * 'PayPal' + category 'Payments'. New behaviour distinguishes:
 *   `PAYPAL *PAYPAL CREDIT ...` → 'PayPal Credit' (Payments — debt repayment)
 *   `PAYPAL *DROPBOXINTE ...`   → 'PayPal: Dropbox' (Subscriptions)
 *   `PAYPAL *STEAM GAMES ...`   → 'PayPal: Steam' (Other)
 *
 * Idempotent: skips rows already migrated, leaves rows with debt_id alone
 * (those are correctly tagged debt repayments — don't disturb category), and
 * only rewrites category when it's still the auto-set 'Payments' value.
 *
 * Run with: npm run backfill-paypal  (from scripts/ dir)
 * Requires: emulators running.
 */

import admin from 'firebase-admin';
import { normalizeMerchant, autoCategorize } from '../client/src/services/csvParser.js';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST not set. Run via `npm run backfill-paypal`.');
  process.exit(1);
}

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

async function run() {
  // Pull every transaction whose stored merchant is the old collapsed value.
  // Filtering server-side keeps the scan small even on a populated dogfood set.
  const snap = await db.collection('transactions').where('merchant', '==', 'PayPal').get();

  if (snap.empty) {
    console.log('No PayPal transactions to back-fill. Nothing to do.');
    return;
  }

  // Fetch user category rules per uid we encounter so the autoCategorize call
  // matches what the import flow would have done. Cached to avoid one query
  // per row.
  const rulesCache = new Map();
  async function rulesFor(uid) {
    if (rulesCache.has(uid)) return rulesCache.get(uid);
    const rs = await db.collection('category_rules').where('user_id', '==', uid).get();
    const rules = rs.docs.map((d) => d.data());
    rulesCache.set(uid, rules);
    return rules;
  }

  let inspected = 0;
  let merchantUpdates = 0;
  let categoryUpdates = 0;
  let skippedTagged = 0;
  const pendingUpdates = [];

  for (const doc of snap.docs) {
    inspected += 1;
    const data = doc.data();
    if (data.debt_id) {
      // Tagged debt payment — category locked to 'Debt Payment'. Still safe to
      // refresh merchant so the row reads correctly, but skip category.
      skippedTagged += 1;
    }
    if (!data.description) continue;

    const newMerchant = normalizeMerchant(data.description);
    if (newMerchant === data.merchant) continue;

    const update = { merchant: newMerchant };
    merchantUpdates += 1;

    // Only rewrite category if still the auto-set 'Payments' value (and not a
    // tagged debt payment). Anything else implies a manual override or a
    // smarter post-import flow already touched it — leave alone.
    if (!data.debt_id && data.category === 'Payments') {
      const userRules = await rulesFor(data.user_id);
      const newCategory = autoCategorize(newMerchant, userRules);
      if (newCategory !== data.category) {
        update.category = newCategory;
        update.suggested_category = newCategory;
        categoryUpdates += 1;
      }
    }

    pendingUpdates.push({ ref: doc.ref, update });
  }

  // Firestore batch limit is 500 ops per commit.
  for (let i = 0; i < pendingUpdates.length; i += 500) {
    const batch = db.batch();
    for (const { ref, update } of pendingUpdates.slice(i, i + 500)) batch.update(ref, update);
    await batch.commit();
  }

  console.log(`Inspected:        ${inspected}`);
  console.log(`Merchant rewrites: ${merchantUpdates}`);
  console.log(`Category rewrites: ${categoryUpdates}`);
  console.log(`Tagged (skipped category only): ${skippedTagged}`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
