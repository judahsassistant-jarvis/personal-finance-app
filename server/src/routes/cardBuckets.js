const express = require('express');
const Joi = require('joi');
const { CardBucket, CreditCard } = require('../models');
const validate = require('../middleware/validate');

const router = express.Router();

const bucketSchema = Joi.object({
  card_id: Joi.string().uuid().required(),
  bucket_name: Joi.string().min(1).max(100).required(),
  bucket_type: Joi.string().valid('transfer', 'purchases').default('purchases'),
  current_balance: Joi.number().precision(2).default(0),
  promo_apr: Joi.number().min(0).precision(3).default(0),
  promo_end_date: Joi.date().allow(null),
});

const updateSchema = Joi.object({
  bucket_name: Joi.string().min(1).max(100),
  bucket_type: Joi.string().valid('transfer', 'purchases'),
  current_balance: Joi.number().precision(2),
  promo_apr: Joi.number().min(0).precision(3),
  promo_end_date: Joi.date().allow(null),
}).min(1);

// GET all buckets (optional filter by card_id)
router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.card_id) where.card_id = req.query.card_id;
    const buckets = await CardBucket.findAll({
      where,
      include: [{ model: CreditCard, as: 'card', attributes: ['id', 'name', 'standard_apr'] }],
      order: [['bucket_name', 'ASC']],
    });
    res.json(buckets);
  } catch (err) {
    next(err);
  }
});

// GET single bucket
router.get('/:id', async (req, res, next) => {
  try {
    const bucket = await CardBucket.findByPk(req.params.id, {
      include: [{ model: CreditCard, as: 'card' }],
    });
    if (!bucket) return res.status(404).json({ error: 'Bucket not found' });
    res.json(bucket);
  } catch (err) {
    next(err);
  }
});

// POST create bucket
router.post('/', validate(bucketSchema), async (req, res, next) => {
  try {
    const bucket = await CardBucket.create(req.body);
    res.status(201).json(bucket);
  } catch (err) {
    next(err);
  }
});

// PUT update bucket
router.put('/:id', validate(updateSchema), async (req, res, next) => {
  try {
    const bucket = await CardBucket.findByPk(req.params.id);
    if (!bucket) return res.status(404).json({ error: 'Bucket not found' });
    await bucket.update(req.body);
    res.json(bucket);
  } catch (err) {
    next(err);
  }
});

// DELETE bucket
router.delete('/:id', async (req, res, next) => {
  try {
    const bucket = await CardBucket.findByPk(req.params.id);
    if (!bucket) return res.status(404).json({ error: 'Bucket not found' });
    await bucket.destroy();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
