const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parseCSV, saveTransactions } = require('../services/csvParser');
const { Account } = require('../models');

const router = express.Router();

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });

// POST /api/import/csv - Upload and parse CSV
router.post('/csv', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const accountId = req.body.account_id;
    if (!accountId) {
      return res.status(400).json({ error: 'account_id is required' });
    }

    // Verify account exists
    const account = await Account.findByPk(accountId);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const result = await parseCSV(req.file.path, accountId);

    // Clean up uploaded file
    fs.unlink(req.file.path, () => {});

    res.json({
      message: `Parsed ${result.count} transactions (${result.format} format)`,
      format: result.format,
      batch_id: result.batch_id,
      count: result.count,
      total_debit: result.total_debit.toFixed(2),
      total_credit: result.total_credit.toFixed(2),
      transactions: result.transactions,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/import/confirm - Save parsed transactions after user review
router.post('/confirm', async (req, res, next) => {
  try {
    const { transactions } = req.body;
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ error: 'transactions array is required' });
    }

    const saved = await saveTransactions(transactions);
    res.status(201).json({
      message: `Saved ${saved.length} transactions`,
      count: saved.length,
      batch_id: transactions[0].import_batch_id,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
