const express = require('express');
const { Op } = require('sequelize');
const { Account, Transaction, MonthlyBudget, CreditCard, CardBucket } = require('../models');

const router = express.Router();

// GET /api/accounts/:id/available - Calculate available funds for an account
// Also GET /api/available - Calculate available funds across all accounts
router.get('/', async (req, res, next) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7) + '-01';
    const monthStart = new Date(month);
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);

    // 1. Total account balances
    const accounts = await Account.findAll();
    const totalBalance = accounts.reduce((s, a) => s + parseFloat(a.balance || 0), 0);

    // 2. Recurring bills for this month
    const recurringBills = await Transaction.findAll({
      where: {
        is_recurring_bill: true,
        date: { [Op.gte]: monthStart, [Op.lt]: monthEnd },
      },
    });
    const totalBills = recurringBills.reduce((s, t) => s + Math.abs(parseFloat(t.amount || 0)), 0);

    // Group bills by category
    const billBreakdown = {};
    for (const t of recurringBills) {
      const cat = t.category || 'Other';
      if (!billBreakdown[cat]) billBreakdown[cat] = 0;
      billBreakdown[cat] += Math.abs(parseFloat(t.amount || 0));
    }

    // 3. Budget allocations for this month
    const budgets = await MonthlyBudget.findAll({
      where: { month: monthStart },
    });
    const totalBudgets = budgets.reduce((s, b) => s + parseFloat(b.allocated_amount || 0), 0);

    // 4. Credit card minimum payments
    const cards = await CreditCard.findAll({
      include: [{ model: CardBucket, as: 'buckets' }],
    });
    let totalMinPayments = 0;
    const cardMinPayments = [];
    for (const card of cards) {
      const cardBalance = (card.buckets || []).reduce((s, b) => s + parseFloat(b.current_balance || 0), 0);
      if (cardBalance <= 0) continue;
      const minByPercent = cardBalance * parseFloat(card.min_percentage || 0.02);
      const minFloor = parseFloat(card.min_floor || 25);
      const minPayment = Math.min(cardBalance, Math.max(minByPercent, minFloor));
      totalMinPayments += minPayment;
      cardMinPayments.push({ card_name: card.name, card_id: card.id, balance: cardBalance, min_payment: parseFloat(minPayment.toFixed(2)) });
    }

    // 5. Calculate available
    const totalOutflow = totalBills + totalBudgets + totalMinPayments;
    const available = totalBalance - totalOutflow;

    res.json({
      total_balance: parseFloat(totalBalance.toFixed(2)),
      recurring_bills: parseFloat(totalBills.toFixed(2)),
      bill_breakdown: billBreakdown,
      budgeted_spending: parseFloat(totalBudgets.toFixed(2)),
      credit_card_min_payments: parseFloat(totalMinPayments.toFixed(2)),
      card_min_payments: cardMinPayments,
      total_outflow: parseFloat(totalOutflow.toFixed(2)),
      available_for_debt: parseFloat(Math.max(0, available).toFixed(2)),
      raw_available: parseFloat(available.toFixed(2)),
      month: month,
      accounts: accounts.map(a => ({ id: a.id, name: a.name, balance: parseFloat(a.balance) })),
      budgets: budgets.map(b => ({ category: b.budget_category, allocated: parseFloat(b.allocated_amount) })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
