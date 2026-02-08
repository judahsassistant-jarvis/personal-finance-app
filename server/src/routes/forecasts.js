const express = require('express');
const Joi = require('joi');
const { ForecastResult, PayoffSchedule, CreditCard, CardBucket, DebtConfig } = require('../models');
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

// POST /api/forecasts/calculate - Run the debt forecast engine
router.post('/calculate', validate(calculateSchema), async (req, res, next) => {
  try {
    const { start_month, months, monthly_budget, strategy } = req.body;
    const startMonth = new Date(start_month).toISOString().slice(0, 10);

    const result = await runForecast({
      startMonth,
      months,
      monthlyBudget: monthly_budget ?? null,
      strategy,
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

    const result = await runForecast({
      startMonth,
      months,
      monthlyBudget: monthly_budget ?? null,
      strategy,
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
