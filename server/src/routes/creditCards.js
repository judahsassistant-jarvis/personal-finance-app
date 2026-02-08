const express = require('express');
const Joi = require('joi');
const { CreditCard, CardBucket } = require('../models');
const validate = require('../middleware/validate');
const validateUUID = require('../middleware/validateUUID');

const router = express.Router();

const cardSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  standard_apr: Joi.number().min(0).precision(3),
  min_percentage: Joi.number().min(0).precision(2).default(0.02),
  min_floor: Joi.number().min(0).precision(2).default(25),
  credit_limit: Joi.number().min(0).precision(2),
  statement_date: Joi.number().integer().min(1).max(31),
});

const updateSchema = Joi.object({
  name: Joi.string().min(1).max(100),
  standard_apr: Joi.number().min(0).precision(3),
  min_percentage: Joi.number().min(0).precision(2),
  min_floor: Joi.number().min(0).precision(2),
  credit_limit: Joi.number().min(0).precision(2),
  statement_date: Joi.number().integer().min(1).max(31),
}).min(1);

// GET all cards with buckets
router.get('/', async (req, res, next) => {
  try {
    const cards = await CreditCard.findAll({
      include: [{ model: CardBucket, as: 'buckets' }],
      order: [['name', 'ASC']],
    });
    res.json(cards);
  } catch (err) {
    next(err);
  }
});

// GET single card
router.get('/:id', validateUUID(), async (req, res, next) => {
  try {
    const card = await CreditCard.findByPk(req.params.id, {
      include: [{ model: CardBucket, as: 'buckets' }],
    });
    if (!card) return res.status(404).json({ error: 'Credit card not found' });
    res.json(card);
  } catch (err) {
    next(err);
  }
});

// POST create card
router.post('/', validate(cardSchema), async (req, res, next) => {
  try {
    const card = await CreditCard.create(req.body);
    res.status(201).json(card);
  } catch (err) {
    next(err);
  }
});

// PUT update card
router.put('/:id', validateUUID(), validate(updateSchema), async (req, res, next) => {
  try {
    const card = await CreditCard.findByPk(req.params.id);
    if (!card) return res.status(404).json({ error: 'Credit card not found' });
    await card.update(req.body);
    res.json(card);
  } catch (err) {
    next(err);
  }
});

// DELETE card
router.delete('/:id', validateUUID(), async (req, res, next) => {
  try {
    const card = await CreditCard.findByPk(req.params.id);
    if (!card) return res.status(404).json({ error: 'Credit card not found' });
    await card.destroy();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
