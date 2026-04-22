/**
 * Pure helpers used by the Debt Planner page and its tests.
 * Kept in its own module so DebtPlanner.jsx can co-live with fast-refresh.
 */
import {
  CARD_LIKE_SUBTYPES,
  INSTALLMENT_SUBTYPES,
  REVOLVING_SUBTYPES,
} from '../firebase/schema.js';
import {
  calcCardMinPayment,
  calcInstallmentMinPayment,
} from '../services/debtForecast.js';

export function enrichDebt(debt, debtBuckets) {
  if (CARD_LIKE_SUBTYPES.has(debt.subtype)) {
    const totalBalance = debtBuckets.reduce((s, b) => s + Number(b.balance_pennies || 0), 0);
    const min = calcCardMinPayment(debt, totalBalance);
    const blendedApr = computeWeightedApr(debtBuckets);
    const promo = computePromoInfo(debtBuckets);
    const utilisation = computeUtilisation(debt, totalBalance);
    return { debt, buckets: debtBuckets, totalBalance, min, blendedApr, promo, utilisation };
  }
  if (INSTALLMENT_SUBTYPES.has(debt.subtype)) {
    const totalBalance = Number(debt.balance_pennies || 0);
    const min = calcInstallmentMinPayment(debt, totalBalance);
    const payoffProgress = computePayoffProgress(debt, totalBalance);
    return { debt, buckets: [], totalBalance, min, blendedApr: Number(debt.standard_apr || 0), promo: null, payoffProgress };
  }
  if (REVOLVING_SUBTYPES.has(debt.subtype)) {
    // Overdrafts are revolving credit — utilisation is the right lens
    // (0% used = clean, 100% = maxed), not payoff progress.
    const totalBalance = Number(debt.balance_pennies || 0);
    const utilisation = computeUtilisation(debt, totalBalance);
    return {
      debt,
      buckets: [],
      totalBalance,
      min: 0,
      blendedApr: Number(debt.standard_apr || 0),
      promo: null,
      utilisation,
    };
  }
  return { debt, buckets: [], totalBalance: 0, min: 0, blendedApr: 0, promo: null };
}

export function computeWeightedApr(buckets) {
  if (!buckets.length) return 0;
  const now = new Date();
  let totalBalance = 0;
  let weighted = 0;
  for (const b of buckets) {
    const bal = Math.max(0, Number(b.balance_pennies || 0));
    if (bal <= 0) continue;
    const effective = effectiveAprFor(b, now);
    totalBalance += bal;
    weighted += bal * effective;
  }
  if (totalBalance <= 0) return 0;
  return weighted / totalBalance;
}

function effectiveAprFor(bucket, now) {
  const apr = Number(bucket.apr ?? 0);
  if (!bucket.is_promo) return apr;
  if (!bucket.promo_end) return apr;
  const end = toDate(bucket.promo_end);
  return end && end >= now ? apr : 0;
}

export function computePromoInfo(buckets) {
  const now = new Date();
  let soonest = null;
  for (const b of buckets) {
    if (!b.is_promo || !b.promo_end) continue;
    const end = toDate(b.promo_end);
    if (!end || end < now) continue;
    if (!soonest || end < soonest.end) {
      soonest = { end, bucket: b };
    }
  }
  if (!soonest) return null;
  const days = Math.ceil((soonest.end - now) / (1000 * 60 * 60 * 24));
  return {
    days,
    end: soonest.end,
    bucketName: soonest.bucket.name,
    balancePennies: Number(soonest.bucket.balance_pennies || 0),
  };
}

export function computeTotals(debts, bucketsByDebtId) {
  let totalPennies = 0;
  let minMonthlyPennies = 0;
  for (const d of debts) {
    if (CARD_LIKE_SUBTYPES.has(d.subtype)) {
      const bal = (bucketsByDebtId.get(d.id) || []).reduce((s, b) => s + Number(b.balance_pennies || 0), 0);
      totalPennies += bal;
      minMonthlyPennies += calcCardMinPayment(d, bal);
    } else if (INSTALLMENT_SUBTYPES.has(d.subtype)) {
      const bal = Number(d.balance_pennies || 0);
      totalPennies += bal;
      minMonthlyPennies += calcInstallmentMinPayment(d, bal);
    } else if (REVOLVING_SUBTYPES.has(d.subtype)) {
      totalPennies += Number(d.balance_pennies || 0);
    }
  }
  return { totalPennies, minMonthlyPennies };
}

export function byPriorityThenBalance(a, b) {
  if (a.debt.priority !== b.debt.priority) return a.debt.priority ? -1 : 1;
  return b.totalBalance - a.totalBalance;
}

// Credit-utilisation thresholds (matches UK credit-bureau conventions —
// Experian's published "good / fair / poor" bands for revolving credit).
// Values are the upper bound of each non-poor band: a ratio strictly below
// GOOD is green, strictly below FAIR is amber, and GE FAIR is red.
export const UTILISATION_THRESHOLDS = Object.freeze({
  GOOD: 0.30,
  FAIR: 0.75,
});

/**
 * Compute utilisation info for a card-like debt. Returns null if the debt has
 * no `limit_pennies` set (or zero) — the UtilisationBar renders nothing in
 * that case. Over-limit is supported: ratio can exceed 1; consumers should
 * cap the visual bar but show the true percentage label.
 */
export function computeUtilisation(debt, totalBalance) {
  const limit = Number(debt?.limit_pennies ?? 0);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const balance = Math.max(0, Number(totalBalance || 0));
  const ratio = balance / limit;
  return {
    ratio,
    limitPennies: limit,
    balancePennies: balance,
    overLimit: balance > limit,
    band: bandForRatio(ratio),
  };
}

function bandForRatio(ratio) {
  if (ratio < UTILISATION_THRESHOLDS.GOOD) return 'good';
  if (ratio < UTILISATION_THRESHOLDS.FAIR) return 'fair';
  return 'poor';
}

// Promo-cliff urgency bands. Matches the 90/60/30/14-day cadence used by
// `generateBtCliffAlerts` (§3.4) so the UI and the Cloud Function speak the
// same tier language — when the email fires, the card's visual state should
// already reflect the same severity.
export const PROMO_URGENCY_THRESHOLDS = Object.freeze({
  CRITICAL: 14,
  URGENT: 30,
  WARNING: 90,
});

/**
 * Bucket a days-remaining count into one of four urgency tiers. Returns null
 * when days is missing so callers can render nothing cleanly.
 *
 *   critical: ≤ 14 days — act now (cloud function sends the 14-day email here)
 *   urgent:   15–30 days — act soon
 *   warning:  31–90 days — on the radar
 *   distant:  > 90 days — heads-up only
 */
export function promoUrgency(days) {
  if (days == null || !Number.isFinite(days)) return null;
  if (days <= PROMO_URGENCY_THRESHOLDS.CRITICAL) return 'critical';
  if (days <= PROMO_URGENCY_THRESHOLDS.URGENT) return 'urgent';
  if (days <= PROMO_URGENCY_THRESHOLDS.WARNING) return 'warning';
  return 'distant';
}

// Badge variant per urgency tier, used by the near-name promo badge in the
// debt row. Kept alongside the helper so badge and detail row agree.
const URGENCY_BADGE_VARIANT = {
  critical: 'destructive',
  urgent: 'warning',
  warning: 'accent',
  distant: 'muted',
};

export function promoBadgeVariant(days) {
  const tier = promoUrgency(days);
  return URGENCY_BADGE_VARIANT[tier] ?? 'accent';
}

/**
 * Payoff progress — how far an installment debt has been paid down from its
 * starting principal toward zero.
 *
 * Only applies to fixed-term debts (BNPL, personal loan) with a recorded
 * `starting_balance_pennies`. Revolving credit (cards, overdrafts) uses
 * utilisation instead — for an overdraft a "100% payoff" reading on a clean
 * balance would be misleading (the user hasn't paid anything off, they just
 * haven't dipped into it). Revolving credit wants the inverse lens:
 * what % of the facility are you currently using?
 *
 * Returns null when no valid starting balance is available (e.g. a legacy
 * debt predating this field). The bar renders nothing in that case rather
 * than faking a 0%.
 *
 * @param {Object} debt - DebtDoc with starting_balance_pennies
 * @param {number} currentBalance - total balance in pennies
 */
export function computePayoffProgress(debt, currentBalance) {
  const startingPennies = Number(debt?.starting_balance_pennies ?? 0);
  if (!Number.isFinite(startingPennies) || startingPennies <= 0) return null;

  const balance = Math.max(0, Number(currentBalance || 0));
  const paidPennies = Math.max(0, startingPennies - balance);
  const progressRatio = Math.min(1, paidPennies / startingPennies);

  return {
    progressRatio,
    startingPennies,
    paidPennies,
    remainingPennies: balance,
  };
}

export function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') return new Date(v);
  if (v && typeof v.toDate === 'function') return v.toDate();
  if (v && typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  return null;
}
