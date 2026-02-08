const express = require('express');
const { ForecastResult, PayoffSchedule, CreditCard } = require('../models');

const router = express.Router();

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
