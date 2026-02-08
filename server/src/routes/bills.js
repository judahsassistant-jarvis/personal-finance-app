const express = require('express');
const Joi = require('joi');
const { MonthlyBudget } = require('../models');
const validate = require('../middleware/validate');
const validateUUID = require('../middleware/validateUUID');

const router = express.Router();

const budgetSchema = Joi.object({
  month: Joi.date().required(),
  budget_category: Joi.string().max(100).required(),
  allocated_amount: Joi.number().precision(2).default(0),
  actual_spent: Joi.number().precision(2).default(0),
  notes: Joi.string().allow('', null),
});

const updateSchema = Joi.object({
  allocated_amount: Joi.number().precision(2),
  actual_spent: Joi.number().precision(2),
  notes: Joi.string().allow('', null),
}).min(1);

// GET budgets (optional filter by month)
router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.month) where.month = req.query.month;
    const budgets = await MonthlyBudget.findAll({
      where,
      order: [['month', 'DESC'], ['budget_category', 'ASC']],
    });
    res.json(budgets);
  } catch (err) {
    next(err);
  }
});

// GET single budget
router.get('/:id', validateUUID(), async (req, res, next) => {
  try {
    const budget = await MonthlyBudget.findByPk(req.params.id);
    if (!budget) return res.status(404).json({ error: 'Budget not found' });
    res.json(budget);
  } catch (err) {
    next(err);
  }
});

// POST create budget
router.post('/', validate(budgetSchema), async (req, res, next) => {
  try {
    const budget = await MonthlyBudget.create(req.body);
    res.status(201).json(budget);
  } catch (err) {
    next(err);
  }
});

// PUT update budget
router.put('/:id', validateUUID(), validate(updateSchema), async (req, res, next) => {
  try {
    const budget = await MonthlyBudget.findByPk(req.params.id);
    if (!budget) return res.status(404).json({ error: 'Budget not found' });
    await budget.update(req.body);
    res.json(budget);
  } catch (err) {
    next(err);
  }
});

// DELETE budget
router.delete('/:id', validateUUID(), async (req, res, next) => {
  try {
    const budget = await MonthlyBudget.findByPk(req.params.id);
    if (!budget) return res.status(404).json({ error: 'Budget not found' });
    await budget.destroy();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
