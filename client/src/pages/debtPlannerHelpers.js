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
    return { debt, buckets: [], totalBalance, min, blendedApr: Number(debt.standard_apr || 0), promo: null };
  }
  if (REVOLVING_SUBTYPES.has(debt.subtype)) {
    return {
      debt,
      buckets: [],
      totalBalance: Number(debt.balance_pennies || 0),
      min: 0,
      blendedApr: Number(debt.standard_apr || 0),
      promo: null,
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

export function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') return new Date(v);
  if (v && typeof v.toDate === 'function') return v.toDate();
  if (v && typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  return null;
}
