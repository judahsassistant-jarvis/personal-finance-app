/**
 * Firestore schema: collection names, enum constants, defaults, factory functions.
 *
 * Monetary values are stored as integer pennies (GBP × 100). Convert at IO edges
 * (input forms, chart rendering). Never store as decimals.
 *
 * APR and rate fields are stored as decimals (0.199 = 19.9%). Never store as percent.
 */

import { serverTimestamp } from 'firebase/firestore';

// ==========================================================================
// Collection names
// ==========================================================================

export const COLLECTIONS = Object.freeze({
  USERS: 'users',
  ACCOUNTS: 'accounts',
  DEBTS: 'debts',
  CARD_BUCKETS: 'card_buckets',
  TRANSACTIONS: 'transactions',
  RECURRING_BILLS: 'recurring_bills',
  MONTHLY_BUDGETS: 'monthly_budgets',
  DEBT_CONFIG: 'debt_config',
  FORECAST_SNAPSHOTS: 'forecast_snapshots',
  AUDIT_LOG: 'audit_log',
  SYSTEM: 'system',
});

// ==========================================================================
// Account subtypes + liquidity
// ==========================================================================

export const ACCOUNT_SUBTYPES = Object.freeze({
  CURRENT: 'current',
  SAVINGS: 'savings',
  CASH_ISA: 'cash_isa',
  SS_ISA: 'ss_isa',
  SIPP: 'sipp',
  INVESTMENT: 'investment',
  PENSION: 'pension',
});

export const LIQUIDITY = Object.freeze({
  LIQUID: 'liquid',
  LOCKED: 'locked',
});

export const DEFAULT_LIQUIDITY = Object.freeze({
  [ACCOUNT_SUBTYPES.CURRENT]: LIQUIDITY.LIQUID,
  [ACCOUNT_SUBTYPES.SAVINGS]: LIQUIDITY.LIQUID,
  [ACCOUNT_SUBTYPES.CASH_ISA]: LIQUIDITY.LIQUID,
  [ACCOUNT_SUBTYPES.SS_ISA]: LIQUIDITY.LOCKED,
  [ACCOUNT_SUBTYPES.SIPP]: LIQUIDITY.LOCKED,
  [ACCOUNT_SUBTYPES.INVESTMENT]: LIQUIDITY.LOCKED,
  [ACCOUNT_SUBTYPES.PENSION]: LIQUIDITY.LOCKED,
});

// Whether the account's balance contributes to safe-to-spend / discretionary
// by default. Independent of `liquidity` (which is about projection semantics
// in the Forecast module). Only current accounts default to true — savings,
// ISAs, and anything locked default to false so that long-term holdings don't
// silently inflate the Debt Planner's auto-suggested budget. User can opt
// others in via the Accounts page if they actively treat them as spending.
export const DEFAULT_SAFE_TO_SPEND = Object.freeze({
  [ACCOUNT_SUBTYPES.CURRENT]: true,
  [ACCOUNT_SUBTYPES.SAVINGS]: false,
  [ACCOUNT_SUBTYPES.CASH_ISA]: false,
  [ACCOUNT_SUBTYPES.SS_ISA]: false,
  [ACCOUNT_SUBTYPES.SIPP]: false,
  [ACCOUNT_SUBTYPES.INVESTMENT]: false,
  [ACCOUNT_SUBTYPES.PENSION]: false,
});

// Default annual rates by subtype (decimal, not percent). Overrideable per account.
export const DEFAULT_RATES = Object.freeze({
  [ACCOUNT_SUBTYPES.CURRENT]: 0,
  [ACCOUNT_SUBTYPES.SAVINGS]: 0.04,
  [ACCOUNT_SUBTYPES.CASH_ISA]: 0.04,
  [ACCOUNT_SUBTYPES.SS_ISA]: 0.05,
  [ACCOUNT_SUBTYPES.SIPP]: 0.05,
  [ACCOUNT_SUBTYPES.INVESTMENT]: 0.05,
  [ACCOUNT_SUBTYPES.PENSION]: 0.05,
});

// ==========================================================================
// Debt subtypes
// ==========================================================================

export const DEBT_SUBTYPES = Object.freeze({
  CARD: 'card',
  BNPL: 'bnpl',
  PERSONAL_LOAN: 'personal_loan',
  OVERDRAFT: 'overdraft',
  STORE_CARD: 'store_card',
});

// Subtypes that use the bucketed interest model (multi-bucket card with per-bucket APR).
// Balance-transfer behaviour is modelled as a promo bucket on a regular card, not a
// separate subtype — a "BT card" is just a card whose buckets happen to include one
// with is_promo=true.
export const CARD_LIKE_SUBTYPES = new Set([
  DEBT_SUBTYPES.CARD,
  DEBT_SUBTYPES.STORE_CARD,
]);

// Subtypes that use fixed-installment math (term + fixed monthly payment)
export const INSTALLMENT_SUBTYPES = new Set([
  DEBT_SUBTYPES.BNPL,
  DEBT_SUBTYPES.PERSONAL_LOAN,
]);

// Subtypes that use revolving-APR math without buckets
export const REVOLVING_SUBTYPES = new Set([
  DEBT_SUBTYPES.OVERDRAFT,
]);

// ==========================================================================
// Pay cycle
// ==========================================================================

export const PAY_CYCLE_CADENCE = Object.freeze({
  MONTHLY: 'monthly',
  FOUR_WEEKLY: '4-weekly',
  BI_WEEKLY: 'bi-weekly',
  WEEKLY: 'weekly',
});

export const SHIFT_RULES = Object.freeze({
  NONE: 'none',
  PRECEDING_WEEKDAY: 'preceding_weekday',
  FOLLOWING_WEEKDAY: 'following_weekday',
});

export const DEFAULT_PAY_CYCLE = Object.freeze({
  cadence: PAY_CYCLE_CADENCE.MONTHLY,
  day_of_month: 28,
  shift_rule: SHIFT_RULES.PRECEDING_WEEKDAY,
  honour_bank_holidays: true,
});

// ==========================================================================
// Debt strategy + tier
// ==========================================================================

export const STRATEGIES = Object.freeze({
  AVALANCHE: 'avalanche',
  SNOWBALL: 'snowball',
  HYBRID: 'hybrid',
});

export const SMALL_BALANCE_BOOST_THRESHOLD_PENNIES = 50000;

export const TIERS = Object.freeze({
  FREE: 'free',
  PRO: 'pro',
});

// ==========================================================================
// Forecast snapshot types
// ==========================================================================

export const FORECAST_TYPES = Object.freeze({
  DEBT: 'debt',        // Debt Planner output
  ACCOUNTS: 'accounts', // Generalised Forecast output
});

// ==========================================================================
// Transaction categories (from Phase 1 csvParser)
// ==========================================================================

export const TRANSACTION_CATEGORIES = Object.freeze([
  'Groceries',
  'Bills',
  'Transport',
  'Dining',
  'Entertainment',
  'Shopping',
  'Healthcare',
  'Debt Payment',
  'Income',
  'Transfer',
  'Other',
]);

// ==========================================================================
// Type definitions (JSDoc)
// ==========================================================================

/**
 * @typedef {Object} PayCycle
 * @property {'monthly' | '4-weekly' | 'bi-weekly' | 'weekly'} cadence
 * @property {number} day_of_month - 1..31; used when cadence is monthly
 * @property {'none' | 'preceding_weekday' | 'following_weekday'} shift_rule
 * @property {boolean} honour_bank_holidays
 */

/**
 * @typedef {Object} UserDoc
 * @property {string} email
 * @property {string} display_name
 * @property {PayCycle} pay_cycle
 * @property {number} buffer_pennies - safe-to-spend buffer before discretionary
 * @property {'free' | 'pro'} tier
 * @property {import('firebase/firestore').FieldValue} created
 */

/**
 * @typedef {Object} AccountDoc
 * @property {string} user_id
 * @property {string} name
 * @property {string} subtype - one of ACCOUNT_SUBTYPES
 * @property {'liquid' | 'locked'} liquidity - projection semantics (Forecast module); independent of safe-to-spend inclusion
 * @property {number} balance_pennies
 * @property {boolean} include_in_safe_to_spend - whether this account contributes to Dashboard safe-to-spend + discretionary. Defaults per subtype (current=true, everything else=false); user-overrideable on the Accounts page.
 * @property {number} [interest_rate] - decimal; for savings / cash_isa
 * @property {number} [growth_rate] - decimal; for ss_isa / sipp / investment / pension
 * @property {number} [sipp_age] - qualifying age in years; for SIPP only
 * @property {number} [monthly_contribution_pennies] - optional auto-contribution used in Forecast
 * @property {import('firebase/firestore').FieldValue} created
 */

/**
 * @typedef {Object} DebtDoc
 * @property {string} user_id
 * @property {string} name
 * @property {string} subtype - one of DEBT_SUBTYPES
 * @property {number} balance_pennies - current balance (for card/revolving/overdraft) or principal (for installments)
 * @property {number} [starting_balance_pennies] - reference balance for payoff-progress bar on installment debts (loan/BNPL); defaults to balance_pennies at creation. Omitted for card_like — those use utilisation instead.
 * @property {number} [standard_apr] - decimal; used by card_like + revolving subtypes
 * @property {number} [min_percentage] - decimal; card subtypes (e.g. 0.02 = 2%)
 * @property {number} [min_floor_pennies] - card subtypes
 * @property {number} [limit_pennies] - card subtypes
 * @property {number} [statement_day] - 1..31; card subtypes
 * @property {number} [fixed_payment_pennies] - installment subtypes (BNPL, personal loan)
 * @property {number} [term_months] - installment subtypes
 * @property {import('firebase/firestore').Timestamp} [start_date] - installment subtypes
 * @property {boolean} priority - flag for visual sort / emphasis
 * @property {number} [payment_due_day] - 1..31 for reminders
 * @property {import('firebase/firestore').FieldValue} created
 */

/**
 * @typedef {Object} CardBucketDoc
 * @property {string} user_id
 * @property {string} debt_id - the parent debt (must have card_like subtype)
 * @property {string} name - e.g. "Purchases", "Balance Transfer"
 * @property {number} balance_pennies
 * @property {number} apr - decimal; the rate for this bucket (promo or standard)
 * @property {boolean} is_promo - true when this is a promo-rate bucket
 * @property {import('firebase/firestore').Timestamp} [promo_end]
 * @property {import('firebase/firestore').FieldValue} created
 */

/**
 * @typedef {Object} TransactionDoc
 * @property {string} user_id
 * @property {string} account_id
 * @property {import('firebase/firestore').Timestamp} date
 * @property {number} amount_pennies - negative for outflow, positive for inflow
 * @property {string} merchant
 * @property {string} [description]
 * @property {string} category - one of TRANSACTION_CATEGORIES
 * @property {string} [suggested_category]
 * @property {boolean} is_recurring
 * @property {string} [debt_id] - set if category === "Debt Payment"
 * @property {string} [import_batch_id]
 * @property {string} [imported_from] - "nationwide" | "revolut" | "virgin_money" | "manual"
 * @property {string} [notes]
 * @property {import('firebase/firestore').FieldValue} created
 */

/**
 * @typedef {Object} RecurringBillDoc
 * @property {string} user_id
 * @property {string} merchant
 * @property {string} category
 * @property {number} expected_amount_pennies
 * @property {number} expected_day_of_month - 1..31; inferred from history or user-set
 * @property {import('firebase/firestore').Timestamp} [last_paid]
 * @property {import('firebase/firestore').Timestamp} [next_expected]
 * @property {boolean} auto_inferred - true if derived from transactions; false if user-created
 * @property {import('firebase/firestore').FieldValue} created
 */

/**
 * @typedef {Object} MonthlyBudgetDoc
 * @property {string} user_id
 * @property {string} month - "YYYY-MM" format, e.g. "2026-04"
 * @property {string} category
 * @property {number} amount_pennies
 * @property {number} [actual_spent_pennies] - computed from transactions, cached here
 * @property {import('firebase/firestore').FieldValue} created
 */

/**
 * @typedef {Object} DebtConfigDoc
 * @property {string} user_id
 * @property {'avalanche' | 'snowball'} strategy
 * @property {number} [monthly_budget_pennies] - user override; if null, use auto-suggested
 * @property {boolean} auto_suggest_budget - if true, Debt Planner uses discretionary as budget
 * @property {import('firebase/firestore').FieldValue} created
 */

/**
 * @typedef {Object} ForecastSnapshotDoc
 * @property {string} user_id
 * @property {'debt' | 'accounts'} type
 * @property {import('firebase/firestore').FieldValue} generated_at
 * @property {Object} payload - opaque to rules; consumer-specific shape
 */

/**
 * @typedef {Object} AuditLogDoc
 * @property {string} user_id
 * @property {string} entity_type
 * @property {string} entity_id
 * @property {'create' | 'update' | 'delete'} action
 * @property {Object} [changes]
 * @property {import('firebase/firestore').FieldValue} timestamp
 */

// ==========================================================================
// Factory functions — produce docs with sensible defaults
// ==========================================================================

/** @returns {UserDoc} */
export function newUserDoc({ email, display_name }) {
  return {
    email,
    display_name: display_name ?? email.split('@')[0],
    pay_cycle: { ...DEFAULT_PAY_CYCLE },
    buffer_pennies: 0,
    tier: TIERS.FREE,
    created: serverTimestamp(),
  };
}

/** @returns {AccountDoc} */
export function newAccountDoc({
  user_id,
  name,
  subtype,
  balance_pennies = 0,
  interest_rate,
  growth_rate,
  sipp_age,
  monthly_contribution_pennies,
  include_in_safe_to_spend,
}) {
  const liquidity = DEFAULT_LIQUIDITY[subtype] ?? LIQUIDITY.LIQUID;
  const rate = DEFAULT_RATES[subtype];
  const safeToSpendDefault = DEFAULT_SAFE_TO_SPEND[subtype] ?? false;
  const doc = {
    user_id,
    name,
    subtype,
    liquidity,
    balance_pennies,
    include_in_safe_to_spend: include_in_safe_to_spend ?? safeToSpendDefault,
    created: serverTimestamp(),
  };
  if (liquidity === LIQUIDITY.LIQUID && rate != null) {
    doc.interest_rate = interest_rate ?? rate;
  } else if (liquidity === LIQUIDITY.LOCKED && rate != null) {
    doc.growth_rate = growth_rate ?? rate;
  }
  if (subtype === ACCOUNT_SUBTYPES.SIPP && sipp_age != null) {
    doc.sipp_age = sipp_age;
  }
  if (monthly_contribution_pennies != null) {
    doc.monthly_contribution_pennies = monthly_contribution_pennies;
  }
  return doc;
}

/** @returns {DebtDoc} */
export function newDebtDoc({
  user_id,
  name,
  starting_balance_pennies,
  subtype,
  balance_pennies = 0,
  standard_apr,
  min_percentage = 0.02,
  min_floor_pennies = 2500,
  limit_pennies,
  statement_day,
  fixed_payment_pennies,
  term_months,
  start_date,
  priority = false,
  payment_due_day,
}) {
  const doc = {
    user_id,
    name,
    subtype,
    balance_pennies,
    priority,
    created: serverTimestamp(),
  };
  // Non-card-like debts anchor "payoff progress" on their starting balance.
  // Default to the current balance if the caller didn't provide one, so a
  // brand-new loan starts at 0% paid off with a coherent reference point.
  // Card-like debts use utilisation (balance / limit) instead, so we skip.
  if (!CARD_LIKE_SUBTYPES.has(subtype)) {
    doc.starting_balance_pennies = starting_balance_pennies ?? balance_pennies;
  }
  if (CARD_LIKE_SUBTYPES.has(subtype)) {
    if (standard_apr != null) doc.standard_apr = standard_apr;
    doc.min_percentage = min_percentage;
    doc.min_floor_pennies = min_floor_pennies;
    if (limit_pennies != null) doc.limit_pennies = limit_pennies;
    if (statement_day != null) doc.statement_day = statement_day;
  } else if (INSTALLMENT_SUBTYPES.has(subtype)) {
    if (fixed_payment_pennies != null) doc.fixed_payment_pennies = fixed_payment_pennies;
    if (term_months != null) doc.term_months = term_months;
    if (start_date != null) doc.start_date = start_date;
    if (standard_apr != null) doc.standard_apr = standard_apr;
  } else if (REVOLVING_SUBTYPES.has(subtype)) {
    if (standard_apr != null) doc.standard_apr = standard_apr;
    if (limit_pennies != null) doc.limit_pennies = limit_pennies;
  }
  if (payment_due_day != null) doc.payment_due_day = payment_due_day;
  return doc;
}

/** @returns {CardBucketDoc} */
export function newCardBucketDoc({
  user_id,
  debt_id,
  name,
  balance_pennies = 0,
  apr = 0,
  is_promo = false,
  promo_end,
}) {
  const doc = {
    user_id,
    debt_id,
    name,
    balance_pennies,
    apr,
    is_promo,
    created: serverTimestamp(),
  };
  if (is_promo && promo_end != null) doc.promo_end = promo_end;
  return doc;
}

/** @returns {TransactionDoc} */
export function newTransactionDoc({
  user_id,
  account_id,
  date,
  amount_pennies,
  merchant,
  description,
  category = 'Other',
  suggested_category,
  is_recurring = false,
  debt_id,
  import_batch_id,
  imported_from = 'manual',
  notes,
}) {
  const doc = {
    user_id,
    account_id,
    date,
    amount_pennies,
    merchant,
    category,
    is_recurring,
    imported_from,
    created: serverTimestamp(),
  };
  if (description) doc.description = description;
  if (suggested_category) doc.suggested_category = suggested_category;
  if (debt_id) doc.debt_id = debt_id;
  if (import_batch_id) doc.import_batch_id = import_batch_id;
  if (notes) doc.notes = notes;
  return doc;
}

/** @returns {RecurringBillDoc} */
export function newRecurringBillDoc({
  user_id,
  merchant,
  category,
  expected_amount_pennies,
  expected_day_of_month,
  last_paid,
  next_expected,
  auto_inferred = false,
}) {
  const doc = {
    user_id,
    merchant,
    category,
    expected_amount_pennies,
    expected_day_of_month,
    auto_inferred,
    created: serverTimestamp(),
  };
  if (last_paid) doc.last_paid = last_paid;
  if (next_expected) doc.next_expected = next_expected;
  return doc;
}

/** @returns {MonthlyBudgetDoc} */
export function newMonthlyBudgetDoc({
  user_id,
  month,
  category,
  amount_pennies = 0,
  actual_spent_pennies = 0,
}) {
  return {
    user_id,
    month,
    category,
    amount_pennies,
    actual_spent_pennies,
    created: serverTimestamp(),
  };
}

/** @returns {DebtConfigDoc} */
export function newDebtConfigDoc({
  user_id,
  strategy = STRATEGIES.AVALANCHE,
  monthly_budget_pennies = null,
  auto_suggest_budget = true,
}) {
  return {
    user_id,
    strategy,
    monthly_budget_pennies,
    auto_suggest_budget,
    created: serverTimestamp(),
  };
}

/** @returns {ForecastSnapshotDoc} */
export function newForecastSnapshotDoc({ user_id, type, payload }) {
  return {
    user_id,
    type,
    generated_at: serverTimestamp(),
    payload,
  };
}

/** @returns {AuditLogDoc} */
export function newAuditLogDoc({ user_id, entity_type, entity_id, action, changes }) {
  const doc = {
    user_id,
    entity_type,
    entity_id,
    action,
    timestamp: serverTimestamp(),
  };
  if (changes) doc.changes = changes;
  return doc;
}

// ==========================================================================
// Money helpers — convert at IO edges
// ==========================================================================

export const poundsToPennies = (gbp) => Math.round(Number(gbp) * 100);
export const penniesToPounds = (pennies) => Number(pennies) / 100;
export const formatGBP = (pennies) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
    .format(penniesToPounds(pennies));
