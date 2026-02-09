const { CreditCard, CardBucket, ForecastResult, PayoffSchedule } = require('../models');

/**
 * Debt Forecast Engine — Avalanche & Snowball strategies
 *
 * Implements the full spec algorithm:
 * 1. Per-bucket interest calculation with promo APR / cliff detection
 * 2. Per-card minimum payment (percentage or floor, scaled if budget tight)
 * 3. Minimum allocation within card (highest APR buckets first)
 * 4. Avalanche priority scoring: effective_apr * 1_000_000 + (30 - position) / 1000
 * 5. Extra allocation globally by priority score
 * 6. Promo cliff tracking (APR jump when promo expires)
 */

/**
 * Determine effective APR for a bucket in a given month.
 * After promo_end_date, falls back to card's standard_apr.
 * Normalizes APR > 1 (user typed "20" instead of "0.20").
 */
function getEffectiveApr(bucket, card, monthDate) {
  if (bucket.balance <= 0) return 0;

  let apr;
  if (bucket.promo_apr != null && bucket.promo_end_date) {
    const promoEnd = new Date(bucket.promo_end_date);
    if (monthDate <= promoEnd) {
      apr = parseFloat(bucket.promo_apr);
    } else {
      apr = parseFloat(card.standard_apr || 0);
    }
  } else if (bucket.promo_apr != null && !bucket.promo_end_date) {
    // Permanent promo rate (e.g. purchases at card rate)
    apr = parseFloat(bucket.promo_apr);
  } else {
    apr = parseFloat(card.standard_apr || 0);
  }

  // Normalize: if user typed 20 instead of 0.20
  if (apr > 1) apr = apr / 100;

  return apr;
}

/**
 * Calculate minimum payment for a card given total balance.
 */
function calcMinPayment(card, totalBalance) {
  if (totalBalance <= 0) return 0;
  const minByPercent = totalBalance * parseFloat(card.min_percentage || 0.02);
  const minFloor = parseFloat(card.min_floor || 25);
  return Math.min(totalBalance, Math.max(minByPercent, minFloor));
}

/**
 * Avalanche priority score for a bucket.
 * Higher score = higher priority for extra payments.
 */
function getAvalancheScore(effectiveApr, positionIndex) {
  return effectiveApr * 1_000_000 + (30 - positionIndex) / 1000;
}

/**
 * Run the forecast simulation.
 *
 * @param {Object} options
 * @param {string} options.startMonth - YYYY-MM-DD (first of month)
 * @param {number} options.months - number of months to project (default 60)
 * @param {number|null} options.monthlyBudget - total monthly payment budget
 * @param {string} options.strategy - 'avalanche' or 'snowball'
 * @param {Object|null} options.cashFlow - { accountBalance, recurringBills, budgetedSpending }
 * @returns {Object} { forecasts, payoffSchedules, debtFreeDate, summary, cliffs }
 */
async function runForecast({ startMonth, months = 60, monthlyBudget = null, strategy = 'avalanche', cashFlow = null }) {
  // 1. Load all cards with buckets
  const cards = await CreditCard.findAll({
    include: [{ model: CardBucket, as: 'buckets' }],
  });

  if (cards.length === 0) {
    return { forecasts: [], payoffSchedules: [], debtFreeDate: null, summary: { totalDebt: 0 }, cliffs: [] };
  }

  // 2. Build initial card states (skip cards with no buckets)
  let bucketPosition = 0;
  const cardStates = cards.filter((card) => card.buckets && card.buckets.length > 0).map((card) => {
    const buckets = (card.buckets || []).map((b) => {
      const state = {
        id: b.id,
        name: b.bucket_name,
        type: b.bucket_type,
        balance: parseFloat(b.current_balance || 0),
        promo_apr: b.promo_apr != null ? parseFloat(b.promo_apr) : null,
        promo_end_date: b.promo_end_date,
        position: bucketPosition++,
      };
      return state;
    });

    const totalBalance = buckets.reduce((s, b) => s + b.balance, 0);

    return {
      cardId: card.id,
      cardName: card.name,
      card,
      buckets,
      totalBalance,
      paidOff: totalBalance <= 0,
      paidOffMonth: null,
      totalInterestPaid: 0,
    };
  });

  const activeCards = cardStates.filter((cs) => !cs.paidOff);
  if (activeCards.length === 0) {
    return {
      forecasts: [], payoffSchedules: [], debtFreeDate: startMonth,
      summary: { totalDebt: 0 }, cliffs: [],
    };
  }

  const forecasts = [];
  const payoffSchedules = [];
  const cliffs = []; // Promo cliff events
  let debtFreeDate = null;

  // 3. Month-by-month simulation
  for (let m = 0; m < months; m++) {
    const monthDate = new Date(startMonth);
    monthDate.setMonth(monthDate.getMonth() + m);
    const monthStr = monthDate.toISOString().slice(0, 10);

    // Check total debt
    const totalDebtStart = cardStates.reduce((s, cs) => s + Math.max(0, cs.totalBalance), 0);
    if (totalDebtStart <= 0.01) {
      debtFreeDate = monthStr;
      break;
    }

    let monthTotalBeginningDebt = 0;
    let monthTotalInterest = 0;
    let monthTotalMinPayments = 0;
    let monthTotalExtraPayments = 0;
    let monthTotalEndingDebt = 0;

    // --- PHASE 1: Calculate interest per bucket ---
    for (const cs of cardStates) {
      if (cs.paidOff) continue;

      cs.beginningBalance = cs.totalBalance;
      monthTotalBeginningDebt += cs.beginningBalance;

      let cardInterest = 0;
      for (const bucket of cs.buckets) {
        if (bucket.balance <= 0) continue;

        const effectiveApr = getEffectiveApr(bucket, cs.card, monthDate);
        bucket.effectiveApr = effectiveApr;

        // Detect promo cliff: did APR just jump this month?
        if (bucket.promo_end_date) {
          const promoEnd = new Date(bucket.promo_end_date);
          const prevMonth = new Date(monthDate);
          prevMonth.setMonth(prevMonth.getMonth() - 1);
          if (prevMonth <= promoEnd && monthDate > promoEnd) {
            const promoApr = parseFloat(bucket.promo_apr || 0);
            const standardApr = parseFloat(cs.card.standard_apr || 0);
            cliffs.push({
              month: monthStr,
              card_name: cs.cardName,
              card_id: cs.cardId,
              bucket_name: bucket.name,
              bucket_id: bucket.id,
              from_apr: promoApr > 1 ? promoApr / 100 : promoApr,
              to_apr: standardApr > 1 ? standardApr / 100 : standardApr,
              balance_at_cliff: parseFloat(bucket.balance.toFixed(2)),
            });
          }
        }

        const monthlyRate = effectiveApr / 12;
        const interest = bucket.balance * monthlyRate;
        bucket.balance += interest;
        bucket.afterInterestBalance = bucket.balance;
        cardInterest += interest;
      }

      cs.totalBalance = cs.buckets.reduce((s, b) => s + Math.max(0, b.balance), 0);
      cs.interestThisMonth = cardInterest;
      cs.totalInterestPaid += cardInterest;
      monthTotalInterest += cardInterest;
    }

    // --- PHASE 2: Calculate minimum payments per card ---
    const minPayments = {};
    let totalMinRequired = 0;
    for (const cs of cardStates) {
      if (cs.paidOff) continue;
      const minPay = calcMinPayment(cs.card, cs.totalBalance);
      minPayments[cs.cardId] = minPay;
      totalMinRequired += minPay;
    }

    // Determine budget for this month
    const totalBudget = monthlyBudget != null ? monthlyBudget : totalMinRequired;

    // Scale minimums if budget < total minimums required (spec step 5)
    let scaleFactor = 1.0;
    if (totalBudget < totalMinRequired && totalMinRequired > 0) {
      scaleFactor = totalBudget / totalMinRequired;
      for (const cardId of Object.keys(minPayments)) {
        minPayments[cardId] *= scaleFactor;
      }
    }

    // --- PHASE 3: Allocate minimums to buckets within each card (high APR first) ---
    for (const cs of cardStates) {
      if (cs.paidOff) continue;

      const cardMin = Math.min(minPayments[cs.cardId], cs.totalBalance);

      // Sort buckets by effective APR descending within this card
      const sortedBuckets = [...cs.buckets]
        .filter((b) => b.balance > 0)
        .sort((a, b) => (b.effectiveApr || 0) - (a.effectiveApr || 0));

      let minRemaining = cardMin;
      for (const bucket of sortedBuckets) {
        if (minRemaining <= 0.01) break;
        const payment = Math.min(minRemaining, bucket.balance);
        bucket.balance -= payment;
        bucket.minAllocation = (bucket.minAllocation || 0) + payment;
        minRemaining -= payment;
      }

      cs.totalBalance = cs.buckets.reduce((s, b) => s + Math.max(0, b.balance), 0);
      cs.minPaymentThisMonth = cardMin - Math.max(0, minRemaining);
      monthTotalMinPayments += cs.minPaymentThisMonth;
    }

    // --- PHASE 4: Calculate extra pool and allocate globally ---
    const extraPool = Math.max(0, totalBudget - monthTotalMinPayments);

    // Build scored bucket list for avalanche/snowball
    const scoredBuckets = [];
    for (const cs of cardStates) {
      if (cs.paidOff) continue;
      for (const bucket of cs.buckets) {
        const remaining = Math.max(0, bucket.balance);
        if (remaining <= 0.01) continue;

        let score;
        if (strategy === 'avalanche') {
          score = getAvalancheScore(bucket.effectiveApr || 0, bucket.position);
        } else {
          // Snowball: lowest remaining balance first (negate for descending sort)
          score = -remaining;
        }

        scoredBuckets.push({
          bucket,
          cardState: cs,
          remaining,
          score,
        });
      }
    }

    // Sort: highest score first
    scoredBuckets.sort((a, b) => b.score - a.score);

    let extraRemaining = extraPool;
    for (const sb of scoredBuckets) {
      if (extraRemaining <= 0.01) break;
      const payment = Math.min(extraRemaining, sb.bucket.balance);
      sb.bucket.balance -= payment;
      sb.bucket.extraAllocation = (sb.bucket.extraAllocation || 0) + payment;
      sb.cardState.extraPaymentThisMonth = (sb.cardState.extraPaymentThisMonth || 0) + payment;
      extraRemaining -= payment;
      monthTotalExtraPayments += payment;
    }

    // --- PHASE 5: Record results and check payoffs ---
    for (const cs of cardStates) {
      if (cs.paidOff) continue;

      cs.totalBalance = cs.buckets.reduce((s, b) => s + Math.max(0, b.balance), 0);

      if (cs.totalBalance <= 0.01) {
        cs.paidOff = true;
        cs.paidOffMonth = monthStr;
        cs.totalBalance = 0;
        cs.buckets.forEach((b) => { b.balance = 0; });
        payoffSchedules.push({
          card_id: cs.cardId,
          payoff_month: monthStr,
          total_interest_on_card: parseFloat(cs.totalInterestPaid.toFixed(2)),
        });
      }

      monthTotalEndingDebt += cs.totalBalance;

      const totalPayment = (cs.minPaymentThisMonth || 0) + (cs.extraPaymentThisMonth || 0);

      // Per-card forecast row
      forecasts.push({
        month: monthStr,
        card_id: cs.cardId,
        card_beginning_balance: parseFloat(cs.beginningBalance.toFixed(2)),
        card_payment_allocation: parseFloat(totalPayment.toFixed(2)),
        card_ending_balance: parseFloat(cs.totalBalance.toFixed(2)),
        card_payoff_date: cs.paidOffMonth || null,
      });

      // Reset monthly trackers
      cs.minPaymentThisMonth = 0;
      cs.extraPaymentThisMonth = 0;
      for (const b of cs.buckets) {
        b.minAllocation = 0;
        b.extraAllocation = 0;
      }
    }

    // Determine cliff warnings for this month
    const monthCliffs = cliffs.filter((c) => c.month === monthStr);

    // Summary row for this month (includes cash flow if provided)
    const summaryRow = {
      month: monthStr,
      card_id: null,
      total_beginning_debt: parseFloat(monthTotalBeginningDebt.toFixed(2)),
      total_interest: parseFloat(monthTotalInterest.toFixed(2)),
      total_minimum_payments: parseFloat(monthTotalMinPayments.toFixed(2)),
      total_extra_payments: parseFloat(monthTotalExtraPayments.toFixed(2)),
      total_ending_debt: parseFloat(monthTotalEndingDebt.toFixed(2)),
      debt_free_date: null,
      has_cliff: monthCliffs.length > 0,
      cliff_details: monthCliffs.length > 0 ? monthCliffs : null,
    };

    // Add cash flow data if provided
    if (cashFlow) {
      summaryRow.account_balance = parseFloat((cashFlow.accountBalance || 0).toFixed(2));
      summaryRow.recurring_bills = parseFloat((cashFlow.recurringBills || 0).toFixed(2));
      summaryRow.budgeted_spending = parseFloat((cashFlow.budgetedSpending || 0).toFixed(2));
      summaryRow.available_for_debt = parseFloat((monthlyBudget || 0).toFixed(2));
    }

    forecasts.push(summaryRow);
  }

  // Set debt_free_date on last summary row
  if (debtFreeDate && forecasts.length > 0) {
    const lastSummary = forecasts.filter((f) => f.card_id === null).pop();
    if (lastSummary) lastSummary.debt_free_date = debtFreeDate;
  }

  const totalDebt = cardStates.reduce((s, cs) => s + parseFloat(cs.beginningBalance || 0), 0);
  const totalInterest = cardStates.reduce((s, cs) => s + cs.totalInterestPaid, 0);

  return {
    forecasts,
    payoffSchedules,
    debtFreeDate,
    cliffs,
    summary: {
      totalDebt: parseFloat(totalDebt.toFixed(2)),
      totalInterest: parseFloat(totalInterest.toFixed(2)),
      strategy,
      monthsToPayoff: forecasts.filter((f) => f.card_id === null).length,
      monthlyBudget,
    },
  };
}

/**
 * Save forecast results to database (clears previous results first).
 */
async function saveForecast(forecasts, payoffSchedules) {
  await ForecastResult.destroy({ where: {} });
  await PayoffSchedule.destroy({ where: {} });

  if (forecasts.length > 0) {
    await ForecastResult.bulkCreate(forecasts);
  }
  if (payoffSchedules.length > 0) {
    await PayoffSchedule.bulkCreate(payoffSchedules);
  }
}

module.exports = { runForecast, saveForecast, getEffectiveApr, calcMinPayment, getAvalancheScore };
