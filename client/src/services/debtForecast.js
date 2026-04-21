/**
 * Debt Forecast Engine — Avalanche & Snowball strategies.
 *
 * Pure function. No Firestore / no IO. The caller fetches debts + buckets and
 * passes them in; the engine returns projections. Matches Phase 1's algorithmic
 * contract for card_like debts but extends to BNPL, personal loans, and
 * overdrafts.
 *
 * Monetary values: pennies (integer on input; float internally to carry sub-penny
 * precision through compounding; rounded to integer on output rows).
 *
 * Algorithm per month:
 *   1. Accrue interest per debt (per-bucket for card_like; per-debt otherwise).
 *   2. Compute minimum payment per debt. Scale minimums globally if budget < sum.
 *   3. Apply minimums to debts.
 *      - card_like: to highest-APR buckets first.
 *      - installment: to balance.
 *      - revolving: to balance.
 *   4. Allocate extra (budget - sum-of-minimums) by strategy score.
 *      - card_like: extra targets are individual buckets (across all cards).
 *      - installment: only personal_loan accepts extra; BNPL does not.
 *      - revolving: accepts extra.
 */

import {
  DEBT_SUBTYPES,
  CARD_LIKE_SUBTYPES,
  INSTALLMENT_SUBTYPES,
  REVOLVING_SUBTYPES,
} from '../firebase/schema.js';

// Subtypes that allow extra (above-minimum) payment allocation.
const ACCEPTS_EXTRA = new Set([
  DEBT_SUBTYPES.CARD,
  DEBT_SUBTYPES.STORE_CARD,
  DEBT_SUBTYPES.PERSONAL_LOAN,
  DEBT_SUBTYPES.OVERDRAFT,
]);

// ---------------------------------------------------------------------------
// Small pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Effective APR for a bucket in a given month, accounting for promo + cliff.
 * Normalises APR > 1 (user typed "20" instead of "0.20").
 */
export function getEffectiveApr(bucket, debt, monthDate) {
  if (bucket.balance_pennies <= 0) return 0;

  const hasPromoEnd = bucket.promo_end != null;
  const promoActive = bucket.is_promo && hasPromoEnd
    ? monthDate <= toDate(bucket.promo_end)
    : bucket.is_promo;

  let apr;
  if (promoActive) {
    apr = Number(bucket.apr ?? 0);
  } else {
    apr = Number(debt.standard_apr ?? 0);
  }
  if (apr > 1) apr = apr / 100;
  return apr;
}

/**
 * Minimum payment for a card-like debt, given its total balance in pennies.
 */
export function calcCardMinPayment(debt, totalBalancePennies) {
  if (totalBalancePennies <= 0) return 0;
  const minPct = Number(debt.min_percentage ?? 0.02);
  const minFloor = Number(debt.min_floor_pennies ?? 2500);
  const minByPct = totalBalancePennies * minPct;
  return Math.min(totalBalancePennies, Math.max(minByPct, minFloor));
}

/**
 * Minimum payment for an installment debt (BNPL, personal loan).
 * Always the fixed monthly payment, clipped at remaining balance.
 */
export function calcInstallmentMinPayment(debt, balancePennies) {
  if (balancePennies <= 0) return 0;
  const fixed = Number(debt.fixed_payment_pennies ?? 0);
  return Math.min(balancePennies, fixed);
}

/**
 * Minimum payment for revolving (overdraft). Default 0 — user pays when they can.
 */
export function calcRevolvingMinPayment(/* debt, balancePennies */) {
  return 0;
}

/**
 * Avalanche score: higher APR → higher priority; tiebreak by insertion position.
 */
export function getAvalancheScore(effectiveApr, positionIndex) {
  return effectiveApr * 1_000_000 + (30 - positionIndex) / 1000;
}

/**
 * Snowball score: smaller remaining balance → higher priority. Negate so that
 * sort-descending-by-score yields smallest-first.
 */
export function getSnowballScore(remainingBalancePennies) {
  return -remainingBalancePennies;
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

/**
 * Run a debt forecast simulation.
 *
 * @param {Object} options
 * @param {Array} options.debts - DebtDoc[]
 * @param {Array} options.buckets - CardBucketDoc[] (only card_like subtypes have these)
 * @param {Date|string} options.startMonth - first month to project from
 * @param {number} [options.months=60]
 * @param {number|null} [options.monthlyBudget] - pennies; null = sum of minimums
 * @param {'avalanche'|'snowball'} [options.strategy]
 * @param {Object|null} [options.cashFlow] - optional context recorded on summary rows
 * @returns {Object} { months, payoffSchedules, cliffs, summary, debtFreeMonth }
 */
export function runForecast({
  debts = [],
  buckets = [],
  startMonth,
  months = 60,
  monthlyBudget = null,
  strategy = 'avalanche',
  cashFlow = null,
}) {
  const start = toDate(startMonth);
  const states = buildInitialStates(debts, buckets);
  const activeStates = states.filter((s) => !s.paidOff);

  const monthsOut = [];
  const payoffSchedules = [];
  const cliffs = [];
  let debtFreeMonth = null;

  if (activeStates.length === 0) {
    return {
      months: [],
      payoffSchedules: [],
      cliffs: [],
      debtFreeMonth: monthStr(start),
      summary: { totalDebtPennies: 0, totalInterestPennies: 0, strategy, monthsToPayoff: 0, monthlyBudgetPennies: monthlyBudget },
    };
  }

  for (let m = 0; m < months; m++) {
    const monthDate = addMonths(start, m);
    const monthLabel = monthStr(monthDate);

    const totalDebtStart = activeStates.reduce((s, cs) => s + Math.max(0, cs.totalBalance), 0);
    if (totalDebtStart <= 1) {
      debtFreeMonth = monthLabel;
      break;
    }

    // Phase 1: accrue interest
    let totalInterestMonth = 0;
    for (const cs of activeStates) {
      if (cs.paidOff) continue;
      cs.beginningBalance = cs.totalBalance;
      const interest = accrueInterest(cs, monthDate, cliffs);
      cs.interestThisMonth = interest;
      cs.totalInterestPaid += interest;
      totalInterestMonth += interest;
      cs.totalBalance = recomputeBalance(cs);
    }

    // Phase 2: compute minimums
    const minByDebt = new Map();
    let totalMin = 0;
    for (const cs of activeStates) {
      if (cs.paidOff) continue;
      const min = minPaymentFor(cs);
      minByDebt.set(cs.debtId, min);
      totalMin += min;
    }

    const budget = monthlyBudget != null ? monthlyBudget : totalMin;

    // Phase 3: scale minimums if budget < total min
    if (budget < totalMin && totalMin > 0) {
      const scale = budget / totalMin;
      for (const id of minByDebt.keys()) {
        minByDebt.set(id, minByDebt.get(id) * scale);
      }
    }

    // Phase 4: apply minimums
    let totalMinApplied = 0;
    for (const cs of activeStates) {
      if (cs.paidOff) continue;
      const min = Math.min(minByDebt.get(cs.debtId) ?? 0, cs.totalBalance);
      applyPayment(cs, min, 'min');
      cs.minPaymentThisMonth = min;
      totalMinApplied += min;
      cs.totalBalance = recomputeBalance(cs);
    }

    // Phase 5: allocate extra by strategy
    const extraPool = Math.max(0, budget - totalMinApplied);
    let totalExtraMonth = 0;
    if (extraPool > 0) {
      const targets = buildExtraTargets(activeStates, strategy);
      let remaining = extraPool;
      for (const tgt of targets) {
        if (remaining <= 0.01) break;
        const take = Math.min(remaining, tgt.remainingCap);
        applyExtraToTarget(tgt, take);
        remaining -= take;
        totalExtraMonth += take;
      }
      for (const cs of activeStates) {
        if (cs.paidOff) continue;
        cs.totalBalance = recomputeBalance(cs);
      }
    }

    // Phase 6: record + detect payoffs
    let totalEndingDebt = 0;
    for (const cs of activeStates) {
      if (cs.paidOff) continue;
      if (cs.totalBalance <= 1) {
        cs.paidOff = true;
        cs.paidOffMonth = monthLabel;
        cs.totalBalance = 0;
        zeroOutBalances(cs);
        payoffSchedules.push({
          debt_id: cs.debtId,
          payoff_month: monthLabel,
          total_interest_pennies: Math.round(cs.totalInterestPaid),
        });
      }
      totalEndingDebt += cs.totalBalance;
    }

    const row = {
      month: monthLabel,
      beginning_debt_pennies: Math.round(activeStates.reduce((s, cs) => s + (cs.beginningBalance || 0), 0)),
      interest_pennies: Math.round(totalInterestMonth),
      minimum_payments_pennies: Math.round(totalMinApplied),
      extra_payments_pennies: Math.round(totalExtraMonth),
      ending_debt_pennies: Math.round(totalEndingDebt),
      per_debt: activeStates.map((cs) => ({
        debt_id: cs.debtId,
        beginning_pennies: Math.round(cs.beginningBalance || 0),
        payment_pennies: Math.round((cs.minPaymentThisMonth || 0) + (cs.extraPaymentThisMonth || 0)),
        ending_pennies: Math.round(cs.totalBalance || 0),
        paid_off_month: cs.paidOffMonth,
      })),
    };
    if (cashFlow) {
      row.account_balance_pennies = cashFlow.accountBalancePennies;
      row.recurring_bills_pennies = cashFlow.recurringBillsPennies;
      row.budgeted_spending_pennies = cashFlow.budgetedSpendingPennies;
      row.available_for_debt_pennies = monthlyBudget;
    }
    monthsOut.push(row);

    // Reset per-month counters
    for (const cs of activeStates) {
      cs.minPaymentThisMonth = 0;
      cs.extraPaymentThisMonth = 0;
      for (const b of cs.buckets) {
        b.minAllocation = 0;
        b.extraAllocation = 0;
      }
    }
  }

  const totalDebt = states.reduce((s, cs) => s + (cs.beginningBalance ?? cs.totalBalance), 0);
  const totalInterest = states.reduce((s, cs) => s + cs.totalInterestPaid, 0);

  return {
    months: monthsOut,
    payoffSchedules,
    cliffs,
    debtFreeMonth,
    summary: {
      totalDebtPennies: Math.round(totalDebt),
      totalInterestPennies: Math.round(totalInterest),
      strategy,
      monthsToPayoff: monthsOut.length,
      monthlyBudgetPennies: monthlyBudget,
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildInitialStates(debts, buckets) {
  const bucketsByDebt = new Map();
  for (const b of buckets) {
    if (!bucketsByDebt.has(b.debt_id)) bucketsByDebt.set(b.debt_id, []);
    bucketsByDebt.get(b.debt_id).push({
      id: b.id ?? `bucket-${bucketsByDebt.get(b.debt_id).length}`,
      name: b.name,
      balance_pennies: Number(b.balance_pennies || 0),
      apr: Number(b.apr || 0),
      is_promo: !!b.is_promo,
      promo_end: b.promo_end,
      position: 0,
    });
  }
  let position = 0;
  const states = [];
  for (const d of debts) {
    const subtype = d.subtype;
    let debtBuckets = [];
    if (CARD_LIKE_SUBTYPES.has(subtype)) {
      debtBuckets = (bucketsByDebt.get(d.id) || []).map((b) => ({ ...b, position: position++ }));
      // Skip card-like debts with no buckets — nothing to forecast.
      if (debtBuckets.length === 0) continue;
    } else if (INSTALLMENT_SUBTYPES.has(subtype) || REVOLVING_SUBTYPES.has(subtype)) {
      // Synthesize a single "bucket" so the internal representation is uniform.
      debtBuckets = [{
        id: `synth-${d.id}`,
        name: d.name,
        balance_pennies: Number(d.balance_pennies || 0),
        apr: Number(d.standard_apr || 0),
        is_promo: false,
        promo_end: null,
        position: position++,
        synthetic: true,
      }];
    } else {
      continue;
    }
    const totalBalance = debtBuckets.reduce((s, b) => s + Math.max(0, b.balance_pennies), 0);
    states.push({
      debtId: d.id,
      name: d.name,
      subtype,
      debt: d,
      buckets: debtBuckets,
      totalBalance,
      paidOff: totalBalance <= 1,
      paidOffMonth: null,
      totalInterestPaid: 0,
      minPaymentThisMonth: 0,
      extraPaymentThisMonth: 0,
    });
  }
  return states;
}

function accrueInterest(cs, monthDate, cliffs) {
  let total = 0;
  for (const b of cs.buckets) {
    if (b.balance_pennies <= 0) continue;
    const apr = CARD_LIKE_SUBTYPES.has(cs.subtype)
      ? getEffectiveApr(b, cs.debt, monthDate)
      : Number(cs.debt.standard_apr || 0);

    // Cliff detection for card_like buckets only.
    if (CARD_LIKE_SUBTYPES.has(cs.subtype) && b.is_promo && b.promo_end) {
      const promoEnd = toDate(b.promo_end);
      const prev = addMonths(monthDate, -1);
      if (prev <= promoEnd && monthDate > promoEnd) {
        const fromApr = Number(b.apr || 0);
        const toApr = Number(cs.debt.standard_apr || 0);
        cliffs.push({
          month: monthStr(monthDate),
          debt_id: cs.debtId,
          debt_name: cs.name,
          bucket_id: b.id,
          bucket_name: b.name,
          from_apr: fromApr > 1 ? fromApr / 100 : fromApr,
          to_apr: toApr > 1 ? toApr / 100 : toApr,
          balance_at_cliff_pennies: Math.round(b.balance_pennies),
        });
      }
    }

    const monthlyRate = apr / 12;
    const interest = b.balance_pennies * monthlyRate;
    b.balance_pennies += interest;
    b.effectiveApr = apr;
    total += interest;
  }
  return total;
}

function minPaymentFor(cs) {
  if (CARD_LIKE_SUBTYPES.has(cs.subtype)) {
    return calcCardMinPayment(cs.debt, cs.totalBalance);
  }
  if (INSTALLMENT_SUBTYPES.has(cs.subtype)) {
    return calcInstallmentMinPayment(cs.debt, cs.totalBalance);
  }
  if (REVOLVING_SUBTYPES.has(cs.subtype)) {
    return calcRevolvingMinPayment(cs.debt, cs.totalBalance);
  }
  return 0;
}

function applyPayment(cs, amount, _tag) {
  if (amount <= 0) return;
  if (CARD_LIKE_SUBTYPES.has(cs.subtype)) {
    // Apply to highest-APR buckets first.
    const sorted = [...cs.buckets]
      .filter((b) => b.balance_pennies > 0)
      .sort((a, b) => (b.effectiveApr || 0) - (a.effectiveApr || 0));
    let remaining = amount;
    for (const b of sorted) {
      if (remaining <= 0.01) break;
      const pay = Math.min(remaining, b.balance_pennies);
      b.balance_pennies -= pay;
      b.minAllocation = (b.minAllocation || 0) + pay;
      remaining -= pay;
    }
  } else {
    // Single synthetic bucket.
    const b = cs.buckets[0];
    const pay = Math.min(amount, b.balance_pennies);
    b.balance_pennies -= pay;
    b.minAllocation = (b.minAllocation || 0) + pay;
  }
}

function buildExtraTargets(states, strategy) {
  const targets = [];
  for (const cs of states) {
    if (cs.paidOff) continue;
    if (!ACCEPTS_EXTRA.has(cs.subtype)) continue;

    if (CARD_LIKE_SUBTYPES.has(cs.subtype)) {
      // Each bucket is a separate target.
      for (const b of cs.buckets) {
        if (b.balance_pennies <= 0.01) continue;
        const score = strategy === 'snowball'
          ? getSnowballScore(cs.totalBalance) // card balance for snowball
          : getAvalancheScore(b.effectiveApr || 0, b.position);
        targets.push({
          cs,
          bucket: b,
          score,
          remainingCap: b.balance_pennies,
        });
      }
    } else {
      const b = cs.buckets[0];
      if (b.balance_pennies <= 0.01) continue;
      const score = strategy === 'snowball'
        ? getSnowballScore(cs.totalBalance)
        : getAvalancheScore(b.effectiveApr || 0, b.position);
      targets.push({
        cs,
        bucket: b,
        score,
        remainingCap: b.balance_pennies,
      });
    }
  }
  targets.sort((a, b) => b.score - a.score);
  return targets;
}

function applyExtraToTarget(tgt, amount) {
  tgt.bucket.balance_pennies -= amount;
  tgt.bucket.extraAllocation = (tgt.bucket.extraAllocation || 0) + amount;
  tgt.cs.extraPaymentThisMonth = (tgt.cs.extraPaymentThisMonth || 0) + amount;
}

function recomputeBalance(cs) {
  return cs.buckets.reduce((s, b) => s + Math.max(0, b.balance_pennies), 0);
}

function zeroOutBalances(cs) {
  for (const b of cs.buckets) b.balance_pennies = 0;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function toDate(d) {
  if (d instanceof Date) return d;
  if (typeof d === 'string') return new Date(d);
  // Firestore Timestamp duck-typing.
  if (d && typeof d.toDate === 'function') return d.toDate();
  if (d && typeof d.seconds === 'number') return new Date(d.seconds * 1000);
  return new Date(d);
}

function monthStr(date) {
  return date.toISOString().slice(0, 10);
}

function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}
