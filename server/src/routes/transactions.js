const express = require('express');
const Joi = require('joi');
const { Transaction, Account } = require('../models');
const validate = require('../middleware/validate');

const router = express.Router();

const transactionSchema = Joi.object({
  account_id: Joi.string().uuid().required(),
  date: Joi.date().required(),
  merchant: Joi.string().max(255).allow('', null),
  description: Joi.string().max(500).allow('', null),
  amount: Joi.number().precision(2).required(),
  category: Joi.string().max(100).default('Other'),
  is_recurring_bill: Joi.boolean().default(false),
  suggested_category: Joi.string().max(100).allow(null),
  notes: Joi.string().allow('', null),
  imported_from: Joi.string().max(50).default('manual'),
  import_batch_id: Joi.string().uuid().allow(null),
});

const updateSchema = Joi.object({
  date: Joi.date(),
  merchant: Joi.string().max(255).allow('', null),
  description: Joi.string().max(500).allow('', null),
  amount: Joi.number().precision(2),
  category: Joi.string().max(100),
  is_recurring_bill: Joi.boolean(),
  notes: Joi.string().allow('', null),
}).min(1);

// GET all transactions with filters
router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.account_id) where.account_id = req.query.account_id;
    if (req.query.category) where.category = req.query.category;
    if (req.query.is_recurring_bill !== undefined) {
      where.is_recurring_bill = req.query.is_recurring_bill === 'true';
    }
    if (req.query.import_batch_id) where.import_batch_id = req.query.import_batch_id;

    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;

    const { count, rows } = await Transaction.findAndCountAll({
      where,
      include: [{ model: Account, as: 'account', attributes: ['id', 'name'] }],
      order: [['date', 'DESC']],
      limit,
      offset,
    });
    res.json({ total: count, transactions: rows });
  } catch (err) {
    next(err);
  }
});

// GET single transaction
router.get('/:id', async (req, res, next) => {
  try {
    const transaction = await Transaction.findByPk(req.params.id, {
      include: [{ model: Account, as: 'account', attributes: ['id', 'name'] }],
    });
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
    res.json(transaction);
  } catch (err) {
    next(err);
  }
});

// POST create transaction
router.post('/', validate(transactionSchema), async (req, res, next) => {
  try {
    const transaction = await Transaction.create(req.body);
    res.status(201).json(transaction);
  } catch (err) {
    next(err);
  }
});

// PUT update transaction
router.put('/:id', validate(updateSchema), async (req, res, next) => {
  try {
    const transaction = await Transaction.findByPk(req.params.id);
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
    await transaction.update(req.body);
    res.json(transaction);
  } catch (err) {
    next(err);
  }
});

// DELETE transaction
router.delete('/:id', async (req, res, next) => {
  try {
    const transaction = await Transaction.findByPk(req.params.id);
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
    await transaction.destroy();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// PATCH bulk update (for categorization after import)
router.patch('/bulk', async (req, res, next) => {
  try {
    const { updates } = req.body;
    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: 'updates must be an array' });
    }
    const results = [];
    for (const { id, ...fields } of updates) {
      const txn = await Transaction.findByPk(id);
      if (txn) {
        await txn.update(fields);
        results.push(txn);
      }
    }
    res.json({ updated: results.length, transactions: results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
