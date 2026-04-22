/**
 * Seed the Firestore emulator with a representative dataset for dogfood dev.
 *
 * Run with: npm run seed  (from scripts/ dir)
 * Requires: emulators running (npm run dev:emulators from repo root).
 *
 * Resets the single seeded user's data (idempotent). Does NOT touch production.
 */

import admin from 'firebase-admin';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST not set. Run via `npm run seed` not `node seed.js`.');
  process.exit(1);
}

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const auth = admin.auth();

// Seeded user UID — represents Judah in the emulator. Not his real Firebase UID.
const SEED_UID = 'judah-seed-uid';
const SEED_EMAIL = 'judahsassistant@gmail.com';

const now = admin.firestore.FieldValue.serverTimestamp();
const Timestamp = admin.firestore.Timestamp;

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return Timestamp.fromDate(d);
}

function monthsFromNow(n) {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return Timestamp.fromDate(d);
}

async function ensureUser() {
  try {
    await auth.getUser(SEED_UID);
  } catch (_) {
    await auth.createUser({
      uid: SEED_UID,
      email: SEED_EMAIL,
      displayName: 'Judah',
      emailVerified: true,
    });
    console.log(`Created emulator auth user ${SEED_UID}`);
  }
}

async function resetUserData() {
  // Delete existing docs owned by SEED_UID across every scoped collection.
  const scopedCollections = [
    'accounts', 'debts', 'card_buckets', 'transactions', 'recurring_bills',
    'monthly_budgets', 'debt_config', 'forecast_snapshots', 'audit_log',
  ];
  for (const name of scopedCollections) {
    const snap = await db.collection(name).where('user_id', '==', SEED_UID).get();
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    if (!snap.empty) await batch.commit();
  }
  await db.doc(`users/${SEED_UID}`).delete().catch(() => {});
  console.log('Cleared existing seed data');
}

async function seedUser() {
  await db.doc(`users/${SEED_UID}`).set({
    email: SEED_EMAIL,
    display_name: 'Judah',
    pay_cycle: {
      cadence: 'monthly',
      day_of_month: 28,
      shift_rule: 'preceding_weekday',
      honour_bank_holidays: true,
    },
    buffer_pennies: 20000, // £200 buffer
    tier: 'free',
    created: now,
  });
}

async function seedAccounts() {
  // include_in_safe_to_spend defaults per DEFAULT_SAFE_TO_SPEND in schema.js —
  // current-only. Savings / ISAs default off; user opts in via Accounts page.
  const accounts = [
    { name: 'Current Account', subtype: 'current', liquidity: 'liquid', balance_pennies: 145000, include_in_safe_to_spend: true },
    { name: 'Savings', subtype: 'savings', liquidity: 'liquid', balance_pennies: 350000, interest_rate: 0.045, include_in_safe_to_spend: false },
    { name: 'Cash ISA', subtype: 'cash_isa', liquidity: 'liquid', balance_pennies: 1200000, interest_rate: 0.05, include_in_safe_to_spend: false },
    { name: 'Stocks & Shares ISA', subtype: 'ss_isa', liquidity: 'locked', balance_pennies: 2800000, growth_rate: 0.055, monthly_contribution_pennies: 20000, include_in_safe_to_spend: false },
    { name: 'SIPP', subtype: 'sipp', liquidity: 'locked', balance_pennies: 4500000, growth_rate: 0.055, sipp_age: 58, monthly_contribution_pennies: 30000, include_in_safe_to_spend: false },
  ];
  const ids = {};
  for (const a of accounts) {
    const ref = db.collection('accounts').doc();
    await ref.set({ user_id: SEED_UID, ...a, created: now });
    ids[a.name] = ref.id;
  }
  return ids;
}

async function seedDebts() {
  const debts = [
    {
      name: 'Barclaycard Platinum',
      subtype: 'card',
      balance_pennies: 320000,
      standard_apr: 0.249,
      min_percentage: 0.025,
      min_floor_pennies: 2500,
      limit_pennies: 500000,
      statement_day: 12,
      priority: true,
      payment_due_day: 5,
    },
    {
      name: 'Halifax Clarity',
      subtype: 'card',
      balance_pennies: 87500,
      standard_apr: 0.198,
      min_percentage: 0.02,
      min_floor_pennies: 2500,
      limit_pennies: 250000,
      statement_day: 20,
      priority: false,
      payment_due_day: 15,
    },
    {
      name: 'Klarna Sofa Purchase',
      subtype: 'bnpl',
      balance_pennies: 54000,
      standard_apr: 0,
      fixed_payment_pennies: 9000,
      term_months: 6,
      start_date: daysAgo(30),
      priority: false,
      payment_due_day: 1,
    },
    {
      name: 'Zopa Personal Loan',
      subtype: 'personal_loan',
      balance_pennies: 450000,
      standard_apr: 0.089,
      fixed_payment_pennies: 18500,
      term_months: 36,
      start_date: daysAgo(180),
      priority: false,
      payment_due_day: 25,
    },
    {
      name: 'Nationwide Overdraft',
      subtype: 'overdraft',
      balance_pennies: 0, // currently clean
      standard_apr: 0.399,
      limit_pennies: 150000,
      priority: false,
    },
  ];
  const ids = {};
  for (const d of debts) {
    const ref = db.collection('debts').doc();
    await ref.set({ user_id: SEED_UID, ...d, created: now });
    ids[d.name] = ref.id;
  }
  return ids;
}

async function seedCardBuckets(debtIds) {
  const barclayCardId = debtIds['Barclaycard Platinum'];
  const cardId = debtIds['Halifax Clarity'];
  const buckets = [
    {
      debt_id: barclayCardId,
      name: 'Balance Transfer (0% promo)',
      balance_pennies: 280000,
      apr: 0,
      is_promo: true,
      promo_end: monthsFromNow(4), // cliff in ~4 months, good for testing alerts
    },
    {
      debt_id: barclayCardId,
      name: 'Purchases',
      balance_pennies: 40000,
      apr: 0.249,
      is_promo: false,
    },
    {
      debt_id: cardId,
      name: 'Purchases',
      balance_pennies: 87500,
      apr: 0.198,
      is_promo: false,
    },
  ];
  for (const b of buckets) {
    const ref = db.collection('card_buckets').doc();
    await ref.set({ user_id: SEED_UID, ...b, created: now });
  }
}

async function seedDebtConfig() {
  await db.collection('debt_config').add({
    user_id: SEED_UID,
    strategy: 'avalanche',
    monthly_budget_pennies: null,
    auto_suggest_budget: true,
    created: now,
  });
}

async function seedRecurringBills() {
  const bills = [
    { merchant: 'Octopus Energy', category: 'Bills', expected_amount_pennies: 12500, expected_day_of_month: 1 },
    { merchant: 'Sky Broadband', category: 'Bills', expected_amount_pennies: 3500, expected_day_of_month: 8 },
    { merchant: 'Vodafone Mobile', category: 'Bills', expected_amount_pennies: 2200, expected_day_of_month: 14 },
    { merchant: 'Netflix', category: 'Entertainment', expected_amount_pennies: 1599, expected_day_of_month: 22 },
    { merchant: 'Spotify', category: 'Entertainment', expected_amount_pennies: 1199, expected_day_of_month: 18 },
    { merchant: 'Council Tax', category: 'Bills', expected_amount_pennies: 17500, expected_day_of_month: 1 },
  ];
  for (const b of bills) {
    const next = new Date();
    if (next.getDate() > b.expected_day_of_month) next.setMonth(next.getMonth() + 1);
    next.setDate(b.expected_day_of_month);
    await db.collection('recurring_bills').add({
      user_id: SEED_UID,
      ...b,
      next_expected: Timestamp.fromDate(next),
      auto_inferred: true,
      created: now,
    });
  }
}

async function seedBudgets() {
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const budgets = [
    { category: 'Groceries', amount_pennies: 40000 },
    { category: 'Transport', amount_pennies: 15000 },
    { category: 'Dining', amount_pennies: 12000 },
    { category: 'Entertainment', amount_pennies: 8000 },
    { category: 'Shopping', amount_pennies: 10000 },
  ];
  for (const b of budgets) {
    await db.collection('monthly_budgets').add({
      user_id: SEED_UID,
      month,
      ...b,
      actual_spent_pennies: 0,
      created: now,
    });
  }
}

async function seedTransactions(accountIds) {
  const currentId = accountIds['Current Account'];
  // 3 months of representative activity; enough for recurring-bill inference.
  const merchants = [
    { m: 'Octopus Energy', cat: 'Bills', amt: -12500, day: 1, recurring: true },
    { m: 'Council Tax', cat: 'Bills', amt: -17500, day: 1, recurring: true },
    { m: 'Sky Broadband', cat: 'Bills', amt: -3500, day: 8, recurring: true },
    { m: 'Vodafone Mobile', cat: 'Bills', amt: -2200, day: 14, recurring: true },
    { m: 'Spotify', cat: 'Entertainment', amt: -1199, day: 18, recurring: true },
    { m: 'Netflix', cat: 'Entertainment', amt: -1599, day: 22, recurring: true },
    { m: 'Tesco', cat: 'Groceries', amt: -7250, day: 5, recurring: false },
    { m: 'Sainsburys', cat: 'Groceries', amt: -6100, day: 12, recurring: false },
    { m: 'TfL', cat: 'Transport', amt: -2800, day: 3, recurring: false },
    { m: 'Employer', cat: 'Income', amt: 380000, day: 28, recurring: true },
  ];
  for (let monthsBack = 0; monthsBack < 3; monthsBack++) {
    for (const t of merchants) {
      const d = new Date();
      d.setMonth(d.getMonth() - monthsBack);
      d.setDate(t.day);
      if (d > new Date()) continue; // don't seed future-dated transactions
      await db.collection('transactions').add({
        user_id: SEED_UID,
        account_id: currentId,
        date: Timestamp.fromDate(d),
        amount_pennies: t.amt,
        merchant: t.m,
        category: t.cat,
        is_recurring: t.recurring,
        imported_from: 'manual',
        created: now,
      });
    }
  }
}

async function seedBankHolidays() {
  await db.doc('system/bank_holidays').set({
    'england-and-wales': {
      division: 'england-and-wales',
      events: [
        { date: '2026-01-01', title: 'New Year’s Day' },
        { date: '2026-04-03', title: 'Good Friday' },
        { date: '2026-04-06', title: 'Easter Monday' },
        { date: '2026-05-04', title: 'Early May bank holiday' },
        { date: '2026-05-25', title: 'Spring bank holiday' },
        { date: '2026-08-31', title: 'Summer bank holiday' },
        { date: '2026-12-25', title: 'Christmas Day' },
        { date: '2026-12-28', title: 'Boxing Day (substitute)' },
      ],
    },
    'scotland': {
      division: 'scotland',
      events: [
        { date: '2026-01-01', title: 'New Year’s Day' },
        { date: '2026-01-02', title: '2nd January' },
        { date: '2026-04-03', title: 'Good Friday' },
        { date: '2026-05-04', title: 'Early May bank holiday' },
        { date: '2026-05-25', title: 'Spring bank holiday' },
        { date: '2026-08-03', title: 'Summer bank holiday' },
        { date: '2026-11-30', title: 'St Andrew’s Day' },
        { date: '2026-12-25', title: 'Christmas Day' },
        { date: '2026-12-28', title: 'Boxing Day (substitute)' },
      ],
    },
    'northern-ireland': {
      division: 'northern-ireland',
      events: [
        { date: '2026-01-01', title: 'New Year’s Day' },
        { date: '2026-03-17', title: 'St Patrick’s Day' },
        { date: '2026-04-03', title: 'Good Friday' },
        { date: '2026-04-06', title: 'Easter Monday' },
        { date: '2026-05-04', title: 'Early May bank holiday' },
        { date: '2026-05-25', title: 'Spring bank holiday' },
        { date: '2026-07-13', title: 'Battle of the Boyne (substitute)' },
        { date: '2026-08-31', title: 'Summer bank holiday' },
        { date: '2026-12-25', title: 'Christmas Day' },
        { date: '2026-12-28', title: 'Boxing Day (substitute)' },
      ],
    },
    fetched_at: admin.firestore.FieldValue.serverTimestamp(),
    source: 'seed',
  });
}

async function main() {
  console.log(`Seeding emulator at ${process.env.FIRESTORE_EMULATOR_HOST} ...`);
  await ensureUser();
  await resetUserData();
  await seedUser();
  const accountIds = await seedAccounts();
  const debtIds = await seedDebts();
  await seedCardBuckets(debtIds);
  await seedDebtConfig();
  await seedRecurringBills();
  await seedBudgets();
  await seedTransactions(accountIds);
  await seedBankHolidays();
  console.log('Seed complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
