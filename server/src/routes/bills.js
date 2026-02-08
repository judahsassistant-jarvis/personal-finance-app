const express = require('express');
const Joi = require('joi');
const { MonthlyBudget } = require('../models');
const validate = require('../middleware/validate');
const validateUUID = require('../middleware/validateUUID');
const { generateSuggestions } = require('../services/budgetSuggestions');

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

// GET budget suggestions based on spending history
router.get('/suggestions', async (req, res, next) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7) + '-01';
    const result = await generateSuggestions(month);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST apply budget suggestions (create budgets from suggestions)
router.post('/apply-suggestions', async (req, res, next) => {
  try {
    const { month, categories } = req.body;
    if (!month || !categories || !Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ error: 'month and categories[] are required' });
    }

    const created = [];
    for (const cat of categories) {
      const [budget, wasCreated] = await MonthlyBudget.findOrCreate({
        where: { month, budget_category: cat.category },
        defaults: {
          month,
          budget_category: cat.category,
          allocated_amount: cat.amount,
        },
      });
      if (!wasCreated) {
        await budget.update({ allocated_amount: cat.amount });
      }
      created.push(budget);
    }

    res.json({ message: `Applied ${created.length} budget suggestions`, budgets: created });
  } catch (err) {
    next(err);
  }
});

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
