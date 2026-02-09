const express = require('express');
const Joi = require('joi');
const { Op } = require('sequelize');
const { ForecastResult, PayoffSchedule, CreditCard, CardBucket, DebtConfig, Account, Transaction, MonthlyBudget } = require('../models');
const { runForecast, saveForecast } = require('../services/debtForecast');
const validate = require('../middleware/validate');

const router = express.Router();

const calculateSchema = Joi.object({
  start_month: Joi.date().default(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }),
  months: Joi.number().integer().min(1).max(360).default(60),
  monthly_budget: Joi.number().precision(2).min(0).allow(null),
  strategy: Joi.string().valid('avalanche', 'snowball').default('avalanche'),
});

/**
 * Calculate cash flow data for a given month.
 * Returns account balance, recurring bills, budgeted spending, and available for debt.
 */
async function getCashFlow(monthStr) {
  const monthStart = new Date(monthStr);
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  const accounts = await Account.findAll();
  const accountBalance = accounts.reduce((s, a) => s + parseFloat(a.balance || 0), 0);

  const recurringBills = await Transaction.findAll({
    where: {
      is_recurring_bill: true,
      date: { [Op.gte]: monthStart, [Op.lt]: monthEnd },
    },
  });
  const totalBills = recurringBills.reduce((s, t) => s + Math.abs(parseFloat(t.amount || 0)), 0);

  const budgets = await MonthlyBudget.findAll({ where: { month: monthStart } });
  const totalBudgets = budgets.reduce((s, b) => s + parseFloat(b.allocated_amount || 0), 0);

  return {
    accountBalance,
    recurringBills: totalBills,
    budgetedSpending: totalBudgets,
    availableForDebt: Math.max(0, accountBalance - totalBills - totalBudgets),
  };
}

// POST /api/forecasts/calculate - Run the debt forecast engine
router.post('/calculate', validate(calculateSchema), async (req, res, next) => {
  try {
    const { start_month, months, monthly_budget, strategy } = req.body;
    const startMonth = new Date(start_month).toISOString().slice(0, 10);

    // Fetch cash flow data for the starting month
    const cashFlow = await getCashFlow(startMonth);

    // If no budget specified, use available funds from cash flow
    const effectiveBudget = monthly_budget ?? cashFlow.availableForDebt;

    const result = await runForecast({
      startMonth,
      months,
      monthlyBudget: effectiveBudget > 0 ? effectiveBudget : null,
      strategy,
      cashFlow,
    });

    // Save to database
    await saveForecast(result.forecasts, result.payoffSchedules);

    res.json({
      message: 'Forecast calculated successfully',
      debt_free_date: result.debtFreeDate,
      summary: result.summary,
      forecast_count: result.forecasts.length,
      payoff_count: result.payoffSchedules.length,
      cliffs: result.cliffs || [],
      cash_flow: cashFlow,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/forecasts/recalculate - Live re-forecast on any input change
router.post('/recalculate', async (req, res, next) => {
  try {
    const { strategy = 'avalanche', monthly_budget, months = 12 } = req.body;

    // Use current month as start
    const now = new Date();
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

    const cashFlow = await getCashFlow(startMonth);
    const effectiveBudget = monthly_budget ?? cashFlow.availableForDebt;

    const result = await runForecast({
      startMonth,
      months,
      monthlyBudget: effectiveBudget > 0 ? effectiveBudget : null,
      strategy,
      cashFlow,
    });

    // Save to database
    await saveForecast(result.forecasts, result.payoffSchedules);

    // Load saved results with card names
    const forecasts = await ForecastResult.findAll({
      include: [{ model: CreditCard, as: 'card', attributes: ['id', 'name', 'standard_apr'] }],
      order: [['month', 'ASC']],
    });

    const payoff = await PayoffSchedule.findAll({
      include: [{ model: CreditCard, as: 'card', attributes: ['id', 'name'] }],
      order: [['payoff_month', 'ASC']],
    });

    res.json({
      message: 'Forecast recalculated',
      debt_free_date: result.debtFreeDate,
      summary: result.summary,
      cliffs: result.cliffs || [],
      cash_flow: cashFlow,
      forecasts,
      payoff_schedule: payoff,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/forecasts/strategy - Get avalanche strategy (card order by APR)
router.get('/strategy', async (req, res, next) => {
  try {
    const cards = await CreditCard.findAll({
      include: [{ model: CardBucket, as: 'buckets' }],
    });

    const strategy = cards
      .filter((card) => card.buckets && card.buckets.length > 0)
      .map((card) => {
        const buckets = (card.buckets || []).map((b) => ({
          id: b.id,
          name: b.bucket_name,
          type: b.bucket_type,
          balance: parseFloat(b.current_balance || 0),
          promo_apr: b.promo_apr != null ? parseFloat(b.promo_apr) : null,
          promo_end_date: b.promo_end_date,
          effective_apr: b.promo_end_date && new Date(b.promo_end_date) < new Date()
            ? parseFloat(card.standard_apr || 0)
            : parseFloat(b.promo_apr ?? card.standard_apr ?? 0),
        }));

        const totalBalance = buckets.reduce((s, b) => s + b.balance, 0);
        const maxApr = Math.max(parseFloat(card.standard_apr || 0), ...buckets.map((b) => b.effective_apr));

        return {
          card_id: card.id,
          card_name: card.name,
          standard_apr: parseFloat(card.standard_apr || 0),
          max_effective_apr: maxApr,
          total_balance: parseFloat(totalBalance.toFixed(2)),
          min_payment: totalBalance > 0
            ? parseFloat(Math.min(totalBalance, Math.max(totalBalance * parseFloat(card.min_percentage || 0.02), parseFloat(card.min_floor || 25))).toFixed(2))
            : 0,
          buckets,
        };
      })
      .filter((c) => c.total_balance > 0)
      .sort((a, b) => b.max_effective_apr - a.max_effective_apr);

    const totalMinPayments = strategy.reduce((s, c) => s + c.min_payment, 0);
    const totalDebt = strategy.reduce((s, c) => s + c.total_balance, 0);

    res.json({
      strategy: 'avalanche',
      description: 'Pay highest APR first to minimize total interest',
      cards: strategy,
      total_debt: parseFloat(totalDebt.toFixed(2)),
      total_min_payments: parseFloat(totalMinPayments.toFixed(2)),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/forecasts/cliffs - Get upcoming promo cliffs within forecast window
router.get('/cliffs', async (req, res, next) => {
  try {
    const months = parseInt(req.query.months) || 12;
    const now = new Date();
    const endDate = new Date(now.getFullYear(), now.getMonth() + months, 1);

    const cards = await CreditCard.findAll({
      include: [{ model: CardBucket, as: 'buckets' }],
    });

    const cliffs = [];
    for (const card of cards) {
      for (const bucket of (card.buckets || [])) {
        if (!bucket.promo_end_date) continue;
        const promoEnd = new Date(bucket.promo_end_date);
        if (promoEnd <= endDate && promoEnd >= now) {
          const balance = parseFloat(bucket.current_balance || 0);
          if (balance <= 0) continue;

          const promoApr = parseFloat(bucket.promo_apr || 0);
          const standardApr = parseFloat(card.standard_apr || 0);
          const monthlyInterestIncrease = balance * (standardApr - promoApr) / 12;

          cliffs.push({
            card_id: card.id,
            card_name: card.name,
            bucket_id: bucket.id,
            bucket_name: bucket.bucket_name,
            promo_end_date: bucket.promo_end_date,
            current_balance: balance,
            from_apr: promoApr > 1 ? promoApr / 100 : promoApr,
            to_apr: standardApr > 1 ? standardApr / 100 : standardApr,
            monthly_interest_increase: parseFloat(monthlyInterestIncrease.toFixed(2)),
            months_until_cliff: Math.ceil((promoEnd - now) / (30 * 24 * 60 * 60 * 1000)),
          });
        }
      }
    }

    cliffs.sort((a, b) => new Date(a.promo_end_date) - new Date(b.promo_end_date));

    res.json({
      cliffs,
      total_cliffs: cliffs.length,
      warning: cliffs.length > 0
        ? `${cliffs.length} promo rate(s) expiring within ${months} months`
        : 'No upcoming promo expirations',
    });
  } catch (err) {
    next(err);
  }
});

// GET forecast results (optional filter by month)
router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.month) where.month = req.query.month;
    const results = await ForecastResult.findAll({
      where,
      include: [{ model: CreditCard, as: 'card', attributes: ['id', 'name'] }],
      order: [['month', 'ASC']],
    });
    res.json(results);
  } catch (err) {
    next(err);
  }
});

// GET payoff schedule
router.get('/payoff', async (req, res, next) => {
  try {
    const schedule = await PayoffSchedule.findAll({
      include: [{ model: CreditCard, as: 'card', attributes: ['id', 'name'] }],
      order: [['payoff_month', 'ASC']],
    });
    res.json(schedule);
  } catch (err) {
    next(err);
  }
});

// DELETE all forecast results (before re-run)
router.delete('/', async (req, res, next) => {
  try {
    await ForecastResult.destroy({ where: {} });
    await PayoffSchedule.destroy({ where: {} });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
