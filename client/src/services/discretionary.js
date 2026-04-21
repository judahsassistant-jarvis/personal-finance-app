/**
 * Safe-to-spend + discretionary calculation (Snoop-style).
 *
 * This is the Dashboard hero number — the thing Judah actually wants to see
 * every morning. Formula:
 *
 *   liquid_balance       = sum(accounts where liquidity === 'liquid')
 *   + expected_income    = inflows expected between now and next pay day
 *   - bills_remaining    = recurring bills not yet paid this cycle
 *   - debt_mins_remaining= debt minimum payments due in this cycle, not yet paid
 *   = safe_to_spend
 *   - buffer             = user-configurable slack
 *   = discretionary      (fed into Debt Planner as default monthly debt budget)
 *
 * Pure function — all inputs are plain data. UI consumer (Dashboard) wires
 * Firestore state + the pay-cycle + bank-holidays services around it.
 */

import { getCurrentCycleBounds } from './payCycle.js';
import { remainingBillsInCycle } from './recurringBills.js';
import {
  CARD_LIKE_SUBTYPES,
  INSTALLMENT_SUBTYPES,
  REVOLVING_SUBTYPES,
  LIQUIDITY,
} from '../firebase/schema.js';

/**
 * @param {Object} opts
 * @param {Array}  opts.accounts          - AccountDoc[]
 * @param {Array}  opts.debts             - DebtDoc[]
 * @param {Array}  opts.bills             - RecurringBillDoc[]
 * @param {Array}  opts.transactions      - TransactionDoc[]
 * @param {Object} opts.payCycle          - user.pay_cycle
 * @param {Object|null} opts.holidayCache - system/bank_holidays doc (or null)
 * @param {number} [opts.bufferPennies=0]
 * @param {Date}   [opts.asOf=new Date()]
 * @returns detailed breakdown for the Dashboard
 */
export function computeDiscretionary({
  accounts = [],
  debts = [],
  bills = [],
  transactions = [],
  payCycle,
  holidayCache = null,
  bufferPennies = 0,
  asOf = new Date(),
}) {
  if (!payCycle) {
    throw new Error('computeDiscretionary requires payCycle');
  }

  const { start: cycleStart, end: cycleEnd } = getCurrentCycleBounds(asOf, payCycle, holidayCache);

  // 1. Liquid balance (current snapshot from accounts).
  const liquidPennies = accounts
    .filter((a) => a.liquidity === LIQUIDITY.LIQUID)
    .reduce((s, a) => s + Number(a.balance_pennies || 0), 0);

  // 2. Expected income: inflow transactions with dates in [now, cycleEnd).
  //    This is conservative — only already-recorded future-dated inflows count.
  //    A smarter version in 4d+ could use recurring-income inference.
  const expectedIncomePennies = transactions
    .filter((t) => {
      const d = toDate(t.date);
      if (!d) return false;
      const isInflow = Number(t.amount_pennies || 0) > 0;
      return isInflow && d >= asOf && d < cycleEnd;
    })
    .reduce((s, t) => s + Number(t.amount_pennies || 0), 0);

  // 3. Bills remaining (pending + missed, all still outflows).
  const billsSummary = remainingBillsInCycle({
    bills,
    transactions,
    cycleStart,
    cycleEnd,
    now: asOf,
  });

  // 4. Debt minimum payments for this cycle, not yet matched by a debt-payment tx.
  const debtMins = debtMinimumsForCycle({ debts, transactions, cycleStart, cycleEnd, asOf });

  const totalOutflowsRemaining = billsSummary.total_remaining_pennies + debtMins.pending_pennies;
  const safeToSpend = liquidPennies + expectedIncomePennies - totalOutflowsRemaining;
  const discretionary = safeToSpend - Number(bufferPennies || 0);

  return {
    cycle: { start: cycleStart, end: cycleEnd },
    liquid_pennies: liquidPennies,
    expected_income_pennies: expectedIncomePennies,
    bills: billsSummary,
    debt_minimums: debtMins,
    total_outflows_remaining_pennies: totalOutflowsRemaining,
    safe_to_spend_pennies: safeToSpend,
    buffer_pennies: Number(bufferPennies || 0),
    discretionary_pennies: discretionary,
  };
}

/**
 * Sum minimum payments per debt for the current cycle, skipping any whose
 * `payment_due_day` has already been covered by a Debt Payment transaction
 * in-cycle.
 *
 * Card-like / installment / revolving all support different min-payment shapes;
 * we lift them from the debt fields without re-running the forecast engine
 * (that's 4d's job).
 */
function debtMinimumsForCycle({ debts, transactions, cycleStart, cycleEnd, asOf }) {
  let pendingPennies = 0;
  let paidPennies = 0;
  let pendingCount = 0;
  let paidCount = 0;

  for (const d of debts) {
    const min = minPaymentForDebt(d);
    if (min <= 0) continue;

    // Match a Debt Payment tx tagged with debt_id, or by amount + recent date.
    const matched = (transactions || []).find((t) => {
      const date = toDate(t.date);
      if (!date || date < cycleStart || date >= cycleEnd) return false;
      if (t.debt_id === d.id) return true;
      if (t.category !== 'Debt Payment') return false;
      const amt = Math.abs(Number(t.amount_pennies || 0));
      return Math.abs(amt - min) <= Math.max(amt, min) * 0.1;
    });

    if (matched) {
      paidPennies += min;
      paidCount += 1;
    } else {
      pendingPennies += min;
      pendingCount += 1;
    }
  }

  return { pending_pennies: pendingPennies, paid_pennies: paidPennies, pending_count: pendingCount, paid_count: paidCount };
}

/**
 * Return the debt's minimum payment in pennies for a single cycle — shape-aware.
 * Card-like uses percentage + floor; installment uses fixed_payment; revolving
 * (overdraft) returns 0 (no contractual minimum).
 */
function minPaymentForDebt(d) {
  const balance = Number(d.balance_pennies || 0);
  if (balance <= 0) return 0;

  if (CARD_LIKE_SUBTYPES.has(d.subtype)) {
    const pct = Number(d.min_percentage ?? 0.02);
    const floor = Number(d.min_floor_pennies ?? 2500);
    return Math.min(balance, Math.max(balance * pct, floor));
  }
  if (INSTALLMENT_SUBTYPES.has(d.subtype)) {
    return Math.min(balance, Number(d.fixed_payment_pennies ?? 0));
  }
  if (REVOLVING_SUBTYPES.has(d.subtype)) {
    return 0;
  }
  return 0;
}

function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  if (v && typeof v.toDate === 'function') return v.toDate();
  if (v && typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  return null;
}
