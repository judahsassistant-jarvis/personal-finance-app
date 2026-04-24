/**
 * What-If BT Scenario Engine
 *
 * Pure functions that produce a modified { debts, buckets } state representing
 * what the user's debt picture would look like AFTER a balance-transfer (BT)
 * scenario is applied. The caller passes the modified state into the existing
 * `runForecast` to get a comparison against the baseline.
 *
 * Two modes:
 *   - Single: move £X from one source debt onto a brand-new BT card.
 *   - Multi:  given a total BT credit limit, allocate across multiple debts
 *             greedily by APR (highest-APR debt cleared first), then move it
 *             all onto a brand-new BT card.
 *
 * Lifts the algorithmic shape of DebtShift's `what_if_screen.dart`
 * (_runScenario / _runOfferScenario), adapted for PFA's pennies + buckets data
 * model.
 */

import {
  DEBT_SUBTYPES,
  CARD_LIKE_SUBTYPES,
} from '../firebase/schema.js';

const SYNTHETIC_ID_PREFIX = 'whatif_';
const DEFAULT_BT_MIN_PERCENTAGE = 0.025;
const DEFAULT_BT_MIN_FLOOR_PENNIES = 2500;

/**
 * Apply a single-debt balance transfer scenario.
 *
 * @param {Object} state - { debts, buckets }
 * @param {Object} opts
 * @param {string} opts.sourceDebtId
 * @param {number} opts.transferPennies - clamped to source balance internally
 * @param {Object} opts.newCard - new BT card spec
 * @param {string} opts.newCard.name
 * @param {number} opts.newCard.standardApr - decimal post-promo APR (e.g. 0.219)
 * @param {number} opts.newCard.promoApr - decimal during promo (typically 0)
 * @param {number} opts.newCard.promoMonths - 0 = no promo
 * @param {number} opts.newCard.feePercent - decimal (e.g. 0.03 for 3%)
 * @param {Date}   opts.now - reference date for promo_end
 * @returns {{ debts, buckets, transfer: { sourceDebtId, transferPennies, feePennies, newCardId } }}
 */
export function applySingleTransfer(state, opts) {
  const { debts, buckets } = state;
  const source = debts.find((d) => d.id === opts.sourceDebtId);
  if (!source) {
    throw new Error(`Source debt not found: ${opts.sourceDebtId}`);
  }

  const sourceBalance = currentDebtBalance(source, buckets);
  const transferPennies = Math.max(0, Math.min(Number(opts.transferPennies || 0), sourceBalance));
  const feePennies = Math.round(transferPennies * Number(opts.newCard.feePercent || 0));

  // 1. Reduce source balance.
  const reduced = reduceDebtBalance(state, opts.sourceDebtId, transferPennies);

  // 2. Build the synthetic new BT card + bucket.
  const newCardId = `${SYNTHETIC_ID_PREFIX}card_${Date.now()}`;
  const newBucketId = `${SYNTHETIC_ID_PREFIX}bucket_${Date.now()}`;
  const newCard = buildBtCardDoc({
    id: newCardId,
    user_id: source.user_id,
    name: opts.newCard.name || 'Balance transfer',
    standardApr: opts.newCard.standardApr,
  });
  const newBucket = buildBtBucketDoc({
    id: newBucketId,
    debt_id: newCardId,
    balancePennies: transferPennies + feePennies,
    promoApr: opts.newCard.promoApr,
    promoMonths: opts.newCard.promoMonths,
    now: opts.now ?? new Date(),
  });

  return {
    debts: [...reduced.debts, newCard],
    buckets: [...reduced.buckets, newBucket],
    transfer: {
      sourceDebtId: opts.sourceDebtId,
      transferPennies,
      feePennies,
      newCardId,
    },
  };
}

/**
 * Apply a multi-debt allocation scenario.
 *
 * @param {Object} state
 * @param {Object} opts
 * @param {number} opts.availableLimitPennies - total BT credit available
 * @param {Array<string>} opts.eligibleDebtIds - user-selected debts to draw from
 * @param {Object} opts.newCard - same shape as single-transfer
 * @param {Date}   opts.now
 * @returns {{ debts, buckets, allocations, transfer }}
 *   allocations: [{ debt_id, transferred_pennies, current_apr }]
 */
export function applyMultiAllocation(state, opts) {
  const { debts, buckets } = state;
  const eligibleSet = new Set(opts.eligibleDebtIds || []);
  const promoApr = Number(opts.newCard.promoApr ?? 0);

  // 1. Flatten eligible debts into (debt, bucket, apr, balance) slices.
  //    - Card-like: one slice per bucket (money in a 0% promo bucket on a
  //      high-APR card isn't costing anything, so ranking by debt APR would
  //      transfer zero-cost money and burn the BT fee on it).
  //    - Installment / revolving: a single slice at the debt's standard_apr.
  //    Slices at or below promoApr are dropped — transferring them is
  //    value-negative (same fee, same or worse interest).
  const slices = [];
  for (const d of debts) {
    if (!eligibleSet.has(d.id)) continue;
    if (CARD_LIKE_SUBTYPES.has(d.subtype)) {
      for (const b of buckets) {
        if (b.debt_id !== d.id) continue;
        const balance = Math.max(0, Number(b.balance_pennies || 0));
        if (balance <= 0) continue;
        const apr = Number(b.apr ?? 0);
        if (apr <= promoApr) continue;
        slices.push({ debt: d, balance, apr });
      }
    } else {
      const balance = Math.max(0, Number(d.balance_pennies || 0));
      if (balance <= 0) continue;
      const apr = Number(d.standard_apr ?? 0);
      if (apr <= promoApr) continue;
      slices.push({ debt: d, balance, apr });
    }
  }

  // 2. Greedy allocation: highest-APR slice first, taking up to the cap.
  //    Aggregate per debt so the output matches the existing UI shape.
  slices.sort((a, b) => b.apr - a.apr);
  let remaining = Math.max(0, Number(opts.availableLimitPennies || 0));
  const perDebt = new Map(); // debt_id -> { transferred, weightedNum }
  for (const s of slices) {
    if (remaining <= 0) break;
    const take = Math.min(s.balance, remaining);
    if (take <= 0) continue;
    remaining -= take;
    const existing = perDebt.get(s.debt.id);
    if (existing) {
      existing.transferred += take;
      existing.weightedNum += take * s.apr;
    } else {
      perDebt.set(s.debt.id, { transferred: take, weightedNum: take * s.apr });
    }
  }

  // perDebt is insertion-ordered; first-seen = highest-APR slice for that
  // debt, so iteration order is stable + ranked like the old implementation.
  const allocations = Array.from(perDebt, ([debt_id, v]) => ({
    debt_id,
    transferred_pennies: v.transferred,
    current_apr: v.weightedNum / v.transferred,
  }));

  const totalTransferPennies = allocations.reduce((s, a) => s + a.transferred_pennies, 0);
  const feePennies = Math.round(totalTransferPennies * Number(opts.newCard.feePercent || 0));

  // 3. Apply each allocation to its source debt.
  let workingState = { debts, buckets };
  for (const a of allocations) {
    workingState = reduceDebtBalance(workingState, a.debt_id, a.transferred_pennies);
  }

  // 4. Build synthetic new BT card with one bucket containing total + fee.
  const newCardId = `${SYNTHETIC_ID_PREFIX}card_${Date.now()}`;
  const newBucketId = `${SYNTHETIC_ID_PREFIX}bucket_${Date.now()}`;
  const sampleDebt = debts[0];
  const newCard = buildBtCardDoc({
    id: newCardId,
    user_id: sampleDebt?.user_id,
    name: opts.newCard.name || 'Balance transfer',
    standardApr: opts.newCard.standardApr,
  });
  const newBucket = buildBtBucketDoc({
    id: newBucketId,
    debt_id: newCardId,
    balancePennies: totalTransferPennies + feePennies,
    promoApr,
    promoMonths: opts.newCard.promoMonths,
    now: opts.now ?? new Date(),
  });

  return {
    debts: [...workingState.debts, newCard],
    buckets: [...workingState.buckets, newBucket],
    allocations,
    transfer: {
      totalTransferPennies,
      feePennies,
      newCardId,
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function currentDebtBalance(debt, buckets) {
  if (CARD_LIKE_SUBTYPES.has(debt.subtype)) {
    return buckets
      .filter((b) => b.debt_id === debt.id)
      .reduce((s, b) => s + Math.max(0, Number(b.balance_pennies || 0)), 0);
  }
  return Math.max(0, Number(debt.balance_pennies || 0));
}

/**
 * Reduce a debt's balance by `amountPennies`, returning a new state object
 * (without mutating the input). For card-like debts, drains buckets in
 * descending APR order — most-expensive money moves first, which matches
 * what a user would want to BT.
 *
 * Card-like debts whose total balance hits zero are NOT removed (the engine
 * tolerates zero-balance buckets); the debt list stays stable so `enrichDebt`
 * still finds it. Installment / revolving debts simply have `balance_pennies`
 * reduced.
 */
function reduceDebtBalance(state, debtId, amountPennies) {
  const debt = state.debts.find((d) => d.id === debtId);
  if (!debt) return state;
  let remaining = amountPennies;

  if (CARD_LIKE_SUBTYPES.has(debt.subtype)) {
    // Sort the debt's buckets by APR desc, drain in order.
    const debtBuckets = state.buckets
      .filter((b) => b.debt_id === debtId)
      .map((b) => ({ ref: b, apr: Number(b.apr ?? 0) }))
      .sort((a, b) => b.apr - a.apr);

    const draftById = new Map();
    for (const { ref } of debtBuckets) {
      const bal = Math.max(0, Number(ref.balance_pennies || 0));
      const take = Math.min(remaining, bal);
      remaining -= take;
      draftById.set(ref.id, { ...ref, balance_pennies: bal - take });
    }

    const newBuckets = state.buckets.map((b) => draftById.get(b.id) ?? b);
    return { debts: state.debts, buckets: newBuckets };
  }

  // Installment / revolving — single balance on the debt itself.
  const newBalance = Math.max(0, Number(debt.balance_pennies || 0) - remaining);
  const newDebts = state.debts.map((d) =>
    d.id === debtId ? { ...d, balance_pennies: newBalance } : d
  );
  return { debts: newDebts, buckets: state.buckets };
}

function buildBtCardDoc({ id, user_id, name, standardApr }) {
  return {
    id,
    user_id,
    name,
    subtype: DEBT_SUBTYPES.CARD,
    balance_pennies: 0, // card-like debts derive total from buckets
    standard_apr: Number(standardApr ?? 0),
    min_percentage: DEFAULT_BT_MIN_PERCENTAGE,
    min_floor_pennies: DEFAULT_BT_MIN_FLOOR_PENNIES,
    priority: false,
    reminders_enabled: false, // synthetic, no real card to remind for
    _synthetic: true,
  };
}

function buildBtBucketDoc({ id, debt_id, balancePennies, promoApr, promoMonths, now }) {
  const bucket = {
    id,
    debt_id,
    name: 'Transferred balance',
    balance_pennies: Math.round(balancePennies),
    apr: Number(promoApr ?? 0),
    is_promo: false,
    _synthetic: true,
  };
  if (promoMonths > 0) {
    const end = new Date(now);
    end.setMonth(end.getMonth() + promoMonths);
    bucket.is_promo = true;
    bucket.promo_end = end;
  }
  return bucket;
}
