const express = require('express');
const Joi = require('joi');
const { Account } = require('../models');
const validate = require('../middleware/validate');

const router = express.Router();

const accountSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  type: Joi.string().valid('checking', 'savings').default('checking'),
  balance: Joi.number().precision(2).required(),
});

const updateSchema = Joi.object({
  name: Joi.string().min(1).max(100),
  type: Joi.string().valid('checking', 'savings'),
  balance: Joi.number().precision(2),
}).min(1);

// GET all accounts
router.get('/', async (req, res, next) => {
  try {
    const accounts = await Account.findAll({ order: [['name', 'ASC']] });
    res.json(accounts);
  } catch (err) {
    next(err);
  }
});

// GET single account
router.get('/:id', async (req, res, next) => {
  try {
    const account = await Account.findByPk(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    res.json(account);
  } catch (err) {
    next(err);
  }
});

// POST create account
router.post('/', validate(accountSchema), async (req, res, next) => {
  try {
    const account = await Account.create(req.body);
    res.status(201).json(account);
  } catch (err) {
    next(err);
  }
});

// PUT update account
router.put('/:id', validate(updateSchema), async (req, res, next) => {
  try {
    const account = await Account.findByPk(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    await account.update(req.body);
    res.json(account);
  } catch (err) {
    next(err);
  }
});

// DELETE account
router.delete('/:id', async (req, res, next) => {
  try {
    const account = await Account.findByPk(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    await account.destroy();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
