const { Op } = require('sequelize');
const { Transaction, MonthlyBudget } = require('../models');

/**
 * Budget Suggestions Engine
 *
 * Analyzes past spending patterns (last 3 months of transactions)
 * and suggests monthly budget allocations by category.
 */

/**
 * Generate budget suggestions based on transaction history.
 *
 * @param {string} targetMonth - YYYY-MM-DD (first of month to suggest budgets for)
 * @returns {Object} { suggestions: [...], analysis: {} }
 */
async function generateSuggestions(targetMonth) {
  const target = new Date(targetMonth);
  const threeMonthsAgo = new Date(target);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  // 1. Get all outgoing transactions from the last 3 months
  const transactions = await Transaction.findAll({
    where: {
      date: { [Op.gte]: threeMonthsAgo, [Op.lt]: target },
      amount: { [Op.lt]: 0 }, // only outflows
    },
    order: [['date', 'ASC']],
  });

  if (transactions.length === 0) {
    return { suggestions: [], analysis: { transactionCount: 0, monthsAnalyzed: 0 } };
  }

  // 2. Group spending by category
  const categorySpending = {};
  const monthSet = new Set();
  for (const t of transactions) {
    const cat = t.category || 'Other';
    const month = t.date.slice(0, 7);
    monthSet.add(month);

    if (!categorySpending[cat]) {
      categorySpending[cat] = { total: 0, count: 0, months: new Set() };
    }
    categorySpending[cat].total += Math.abs(parseFloat(t.amount));
    categorySpending[cat].count += 1;
    categorySpending[cat].months.add(month);
  }

  const monthsAnalyzed = monthSet.size || 1;

  // 3. Calculate averages and build suggestions
  // Exclude categories that are typically handled elsewhere (payments to credit cards, transfers)
  const excludeCategories = new Set(['Payments', 'Transfer']);

  const suggestions = [];
  for (const [category, data] of Object.entries(categorySpending)) {
    if (excludeCategories.has(category)) continue;

    const monthlyAvg = data.total / monthsAnalyzed;
    // Add 10% buffer for variance
    const suggested = Math.ceil(monthlyAvg * 1.1);

    // Determine confidence based on consistency
    const consistency = data.months.size / monthsAnalyzed;
    let confidence;
    if (consistency >= 0.8 && data.count >= 3) {
      confidence = 'high';
    } else if (consistency >= 0.5) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    suggestions.push({
      category,
      monthly_average: parseFloat(monthlyAvg.toFixed(2)),
      suggested_amount: suggested,
      transaction_count: data.count,
      months_seen: data.months.size,
      confidence,
    });
  }

  // Sort by suggested amount descending
  suggestions.sort((a, b) => b.suggested_amount - a.suggested_amount);

  // 4. Check existing budgets for this month
  const existingBudgets = await MonthlyBudget.findAll({
    where: { month: target },
  });

  const existingCategories = new Set(existingBudgets.map((b) => b.budget_category));

  // Mark which suggestions already have budgets
  for (const s of suggestions) {
    s.already_budgeted = existingCategories.has(s.category);
    const existing = existingBudgets.find((b) => b.budget_category === s.category);
    if (existing) {
      s.current_allocation = parseFloat(existing.allocated_amount);
    }
  }

  const totalSuggested = suggestions.reduce((s, sg) => s + sg.suggested_amount, 0);

  return {
    suggestions,
    analysis: {
      transactionCount: transactions.length,
      monthsAnalyzed,
      categoriesFound: suggestions.length,
      totalSuggestedMonthly: totalSuggested,
    },
  };
}

module.exports = { generateSuggestions };
