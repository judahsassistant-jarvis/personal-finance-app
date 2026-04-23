/**
 * Cloud Function integration test — Sprint 10.
 *
 * Drives both scheduled-scan functions end-to-end against the Firestore emulator:
 *   1. Seed a test user + debt + promo bucket + (optionally) a paid transaction.
 *   2. Invoke runBtCliffScan / runPaymentReminderScan with an injected `today`.
 *   3. Assert that /mail and /notification_log docs are written as expected.
 *   4. Run again → assert idempotency (no new /mail docs).
 *
 * Emulator must be running (firebase emulators:start). The test is read-write
 * against the same Firestore instance the dev uses; it creates docs under a
 * test-only UID prefix and cleans up after itself.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

// Set these before require()ing firebase-admin so the SDK auto-connects.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'personal-finance-app-dev-3ffb2';

const admin = require('firebase-admin');

// Require the functions module FIRST — it calls initializeApp() with the
// runtime-provided GCLOUD_PROJECT. Initialising here too would conflict.
const { _runBtCliffScan, _runPaymentReminderScan } = require('../index.js');

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const TEST_UID = 'integration-test-user';
const TEST_EMAIL = 'judahsassistant@gmail.com';
const TEST_USER_DOC_ID = TEST_UID;
const TEST_DEBT_ID_PREFIX = 'integration-test-debt';
const TEST_BUCKET_ID_PREFIX = 'integration-test-bucket';

function daysFromNow(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

async function deleteTestData() {
  // Delete all mail + notification_log + debts + card_buckets + transactions +
  // debt_config + users/{TEST_UID} written by this test.
  const collections = [
    'mail',
    'notification_log',
    'debts',
    'card_buckets',
    'transactions',
    'debt_config',
  ];
  for (const col of collections) {
    // Most test docs are user-scoped — filter on user_id where possible.
    const snap = await db.collection(col).where('user_id', '==', TEST_UID).get().catch(() => ({ empty: true, docs: [] }));
    for (const d of snap.docs) await d.ref.delete();
  }
  // mail docs don't have user_id. Filter by to array containing the test email.
  const mailSnap = await db.collection('mail').get();
  for (const d of mailSnap.docs) {
    const to = d.data().to;
    if (Array.isArray(to) && to.includes(TEST_EMAIL)) {
      await d.ref.delete();
    }
  }
  // notification_log log keys start with "bt_" / "payment_" + UID. Extra sweep.
  const nlSnap = await db.collection('notification_log').get();
  for (const d of nlSnap.docs) {
    if (d.id.includes(TEST_UID)) await d.ref.delete();
  }
  await db.doc(`users/${TEST_USER_DOC_ID}`).delete().catch(() => {});
}

async function seedUser() {
  await db.doc(`users/${TEST_USER_DOC_ID}`).set({
    email: TEST_EMAIL,
    display_name: 'Test User',
    tier: 'free',
    onboarding_complete: true,
    created: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function countMail() {
  const snap = await db.collection('mail').get();
  return snap.docs.filter((d) => (d.data().to || []).includes(TEST_EMAIL)).length;
}

async function mailSubjects() {
  const snap = await db.collection('mail').get();
  return snap.docs
    .filter((d) => (d.data().to || []).includes(TEST_EMAIL))
    .map((d) => d.data().message?.subject);
}

before(async () => {
  await deleteTestData();
});

after(async () => {
  await deleteTestData();
});

// ---------------------------------------------------------------------------
// BT cliff alerts
// ---------------------------------------------------------------------------

describe('runBtCliffScan', () => {
  beforeEach(async () => {
    await deleteTestData();
    await seedUser();
  });

  it('writes a mail + log entry for a promo bucket inside 14 days', async () => {
    const today = new Date(2026, 3, 23); // 23 Apr 2026
    const debtId = `${TEST_DEBT_ID_PREFIX}-14d`;
    const bucketId = `${TEST_BUCKET_ID_PREFIX}-14d`;

    await db.doc(`debts/${debtId}`).set({
      user_id: TEST_UID,
      name: 'Test Barclaycard',
      subtype: 'card',
      balance_pennies: 0,
      reminders_enabled: false,
      created: admin.firestore.FieldValue.serverTimestamp(),
    });
    await db.doc(`card_buckets/${bucketId}`).set({
      user_id: TEST_UID,
      debt_id: debtId,
      name: 'Balance Transfer',
      balance_pennies: 250000,
      apr: 0,
      is_promo: true,
      promo_end: Timestamp.fromDate(daysFromNow(today, 10)), // 10 days out → 14d band
      created: admin.firestore.FieldValue.serverTimestamp(),
    });

    const res = await _runBtCliffScan({ db, today });
    assert.strictEqual(res.sent, 1);
    assert.strictEqual(await countMail(), 1);
    const subjects = await mailSubjects();
    assert.ok(subjects[0].includes('Test Barclaycard'), `unexpected subject: ${subjects[0]}`);
    assert.ok(subjects[0].includes('Balance Transfer'), `unexpected subject: ${subjects[0]}`);
    assert.ok(subjects[0].match(/10 days/), `expected 10 days in subject, got: ${subjects[0]}`);

    // Re-run — idempotency: no new mail, same log entry.
    const res2 = await _runBtCliffScan({ db, today });
    assert.strictEqual(res2.sent, 0);
    assert.strictEqual(await countMail(), 1);
  });

  it('skips promos > 90 days out', async () => {
    const today = new Date(2026, 3, 23);
    const debtId = `${TEST_DEBT_ID_PREFIX}-far`;
    const bucketId = `${TEST_BUCKET_ID_PREFIX}-far`;

    await db.doc(`debts/${debtId}`).set({
      user_id: TEST_UID, name: 'Far Promo', subtype: 'card', balance_pennies: 0,
      created: admin.firestore.FieldValue.serverTimestamp(),
    });
    await db.doc(`card_buckets/${bucketId}`).set({
      user_id: TEST_UID, debt_id: debtId, name: 'BT', balance_pennies: 100000,
      apr: 0, is_promo: true,
      promo_end: Timestamp.fromDate(daysFromNow(today, 120)),
      created: admin.firestore.FieldValue.serverTimestamp(),
    });

    const res = await _runBtCliffScan({ db, today });
    assert.strictEqual(res.sent, 0);
    assert.strictEqual(await countMail(), 0);
  });

  it('skips non-promo buckets', async () => {
    const today = new Date(2026, 3, 23);
    const debtId = `${TEST_DEBT_ID_PREFIX}-nopromo`;
    const bucketId = `${TEST_BUCKET_ID_PREFIX}-nopromo`;
    await db.doc(`debts/${debtId}`).set({
      user_id: TEST_UID, name: 'Regular', subtype: 'card', balance_pennies: 0,
      created: admin.firestore.FieldValue.serverTimestamp(),
    });
    await db.doc(`card_buckets/${bucketId}`).set({
      user_id: TEST_UID, debt_id: debtId, name: 'Purchases', balance_pennies: 50000,
      apr: 0.199, is_promo: false,
      created: admin.firestore.FieldValue.serverTimestamp(),
    });
    const res = await _runBtCliffScan({ db, today });
    assert.strictEqual(res.sent, 0);
  });

  it('re-fires when promo_end is extended (different log key)', async () => {
    const today = new Date(2026, 3, 23);
    const debtId = `${TEST_DEBT_ID_PREFIX}-extend`;
    const bucketId = `${TEST_BUCKET_ID_PREFIX}-extend`;
    await db.doc(`debts/${debtId}`).set({
      user_id: TEST_UID, name: 'Extendable', subtype: 'card', balance_pennies: 0,
      created: admin.firestore.FieldValue.serverTimestamp(),
    });
    const bucketRef = db.doc(`card_buckets/${bucketId}`);
    await bucketRef.set({
      user_id: TEST_UID, debt_id: debtId, name: 'BT', balance_pennies: 100000,
      apr: 0, is_promo: true,
      promo_end: Timestamp.fromDate(daysFromNow(today, 10)),
      created: admin.firestore.FieldValue.serverTimestamp(),
    });

    const first = await _runBtCliffScan({ db, today });
    assert.strictEqual(first.sent, 1);

    // Extend the promo 60 days further — same threshold may apply, different log key.
    await bucketRef.update({ promo_end: Timestamp.fromDate(daysFromNow(today, 70)) });
    const second = await _runBtCliffScan({ db, today });
    assert.strictEqual(second.sent, 1, 'second scan should send a fresh 90d alert for the new promo_end');
    assert.strictEqual(await countMail(), 2);
  });
});

// ---------------------------------------------------------------------------
// Payment reminders
// ---------------------------------------------------------------------------

describe('runPaymentReminderScan', () => {
  beforeEach(async () => {
    await deleteTestData();
    await seedUser();
    // Default debt_config.
    await db.collection('debt_config').add({
      user_id: TEST_UID,
      strategy: 'avalanche',
      monthly_budget_pennies: null,
      auto_suggest_budget: true,
      reminder_days_before: 3,
      created: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  it('fires day_of reminder on due day', async () => {
    const today = new Date(2026, 3, 15);
    const debtId = `${TEST_DEBT_ID_PREFIX}-dayof`;
    await db.doc(`debts/${debtId}`).set({
      user_id: TEST_UID, name: 'Zopa Loan', subtype: 'personal_loan',
      balance_pennies: 500000, standard_apr: 0.099,
      fixed_payment_pennies: 21000, term_months: 24,
      payment_due_day: 15, reminders_enabled: true,
      created: admin.firestore.FieldValue.serverTimestamp(),
    });

    const res = await _runPaymentReminderScan({ db, today });
    assert.strictEqual(res.sent, 1);
    const subjects = await mailSubjects();
    assert.ok(subjects[0].includes('due today'), `expected "due today" in ${subjects[0]}`);

    // Idempotency: re-run same day → no new mail.
    const res2 = await _runPaymentReminderScan({ db, today });
    assert.strictEqual(res2.sent, 0);
    assert.strictEqual(await countMail(), 1);
  });

  it('fires upcoming reminder 3 days before (default)', async () => {
    const today = new Date(2026, 3, 12);
    const debtId = `${TEST_DEBT_ID_PREFIX}-upcoming`;
    await db.doc(`debts/${debtId}`).set({
      user_id: TEST_UID, name: 'Barclaycard', subtype: 'card',
      balance_pennies: 0, payment_due_day: 15, reminders_enabled: true,
      created: admin.firestore.FieldValue.serverTimestamp(),
    });

    const res = await _runPaymentReminderScan({ db, today });
    assert.strictEqual(res.sent, 1);
    const subjects = await mailSubjects();
    assert.ok(subjects[0].includes('due on the 15th'), `got: ${subjects[0]}`);
  });

  it('honours reminder_days_before override on debt_config', async () => {
    // Drop default config + write override of 7.
    const configs = await db.collection('debt_config').where('user_id', '==', TEST_UID).get();
    for (const c of configs.docs) await c.ref.delete();
    await db.collection('debt_config').add({
      user_id: TEST_UID, strategy: 'avalanche',
      monthly_budget_pennies: null, auto_suggest_budget: true,
      reminder_days_before: 7,
      created: admin.firestore.FieldValue.serverTimestamp(),
    });

    const today = new Date(2026, 3, 8); // 7 days before 15 Apr
    const debtId = `${TEST_DEBT_ID_PREFIX}-7days`;
    await db.doc(`debts/${debtId}`).set({
      user_id: TEST_UID, name: 'Big debt', subtype: 'card',
      balance_pennies: 0, payment_due_day: 15, reminders_enabled: true,
      created: admin.firestore.FieldValue.serverTimestamp(),
    });

    const res = await _runPaymentReminderScan({ db, today });
    assert.strictEqual(res.sent, 1);
  });

  it('is suppressed when a transaction is tagged against the debt in the current cycle', async () => {
    const today = new Date(2026, 3, 15);
    const debtId = `${TEST_DEBT_ID_PREFIX}-paid`;
    await db.doc(`debts/${debtId}`).set({
      user_id: TEST_UID, name: 'Paid Card', subtype: 'card',
      balance_pennies: 0, payment_due_day: 15, reminders_enabled: true,
      created: admin.firestore.FieldValue.serverTimestamp(),
    });
    // Tagged transaction dated within the current cycle (cycle starts
    // 15 Mar 2026 per cycleStartFromDueDate).
    await db.collection('transactions').add({
      user_id: TEST_UID, account_id: 'fake',
      date: Timestamp.fromDate(new Date(2026, 3, 10)),
      amount_pennies: -10000,
      merchant: 'BARCLAYCARD BP',
      category: 'Debt Payment',
      is_recurring: false, imported_from: 'manual',
      debt_id: debtId,
      created: admin.firestore.FieldValue.serverTimestamp(),
    });

    const res = await _runPaymentReminderScan({ db, today });
    assert.strictEqual(res.sent, 0, 'reminder should be suppressed when a payment is already logged');
    assert.strictEqual(await countMail(), 0);
  });

  it('does not fire for debts with reminders_enabled=false', async () => {
    const today = new Date(2026, 3, 15);
    const debtId = `${TEST_DEBT_ID_PREFIX}-disabled`;
    await db.doc(`debts/${debtId}`).set({
      user_id: TEST_UID, name: 'Quiet', subtype: 'card',
      balance_pennies: 0, payment_due_day: 15, reminders_enabled: false,
      created: admin.firestore.FieldValue.serverTimestamp(),
    });
    const res = await _runPaymentReminderScan({ db, today });
    assert.strictEqual(res.sent, 0);
  });

  it('returns 0 when today is not a reminder day', async () => {
    const today = new Date(2026, 3, 5); // 10 days before 15th — not a trigger
    const debtId = `${TEST_DEBT_ID_PREFIX}-silent`;
    await db.doc(`debts/${debtId}`).set({
      user_id: TEST_UID, name: 'Silent', subtype: 'card',
      balance_pennies: 0, payment_due_day: 15, reminders_enabled: true,
      created: admin.firestore.FieldValue.serverTimestamp(),
    });
    const res = await _runPaymentReminderScan({ db, today });
    assert.strictEqual(res.sent, 0);
  });
});
