const express = require('express');
const Joi = require('joi');
const { DebtConfig } = require('../models');
const validate = require('../middleware/validate');

const router = express.Router();

const configSchema = Joi.object({
  month: Joi.date().required(),
  monthly_payment_budget: Joi.number().precision(2),
  strategy: Joi.string().valid('avalanche', 'snowball').default('avalanche'),
  auto_calculate: Joi.boolean().default(true),
  notes: Joi.string().allow('', null),
});

const updateSchema = Joi.object({
  monthly_payment_budget: Joi.number().precision(2),
  strategy: Joi.string().valid('avalanche', 'snowball'),
  auto_calculate: Joi.boolean(),
  notes: Joi.string().allow('', null),
}).min(1);

// GET all configs
router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.month) where.month = req.query.month;
    const configs = await DebtConfig.findAll({
      where,
      order: [['month', 'DESC']],
    });
    res.json(configs);
  } catch (err) {
    next(err);
  }
});

// GET single config
router.get('/:id', async (req, res, next) => {
  try {
    const config = await DebtConfig.findByPk(req.params.id);
    if (!config) return res.status(404).json({ error: 'Debt config not found' });
    res.json(config);
  } catch (err) {
    next(err);
  }
});

// POST create config
router.post('/', validate(configSchema), async (req, res, next) => {
  try {
    const config = await DebtConfig.create(req.body);
    res.status(201).json(config);
  } catch (err) {
    next(err);
  }
});

// PUT update config
router.put('/:id', validate(updateSchema), async (req, res, next) => {
  try {
    const config = await DebtConfig.findByPk(req.params.id);
    if (!config) return res.status(404).json({ error: 'Debt config not found' });
    await config.update(req.body);
    res.json(config);
  } catch (err) {
    next(err);
  }
});

// DELETE config
router.delete('/:id', async (req, res, next) => {
  try {
    const config = await DebtConfig.findByPk(req.params.id);
    if (!config) return res.status(404).json({ error: 'Debt config not found' });
    await config.destroy();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
