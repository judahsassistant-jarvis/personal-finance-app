/**
 * Budget suggestions — pure function over transaction history.
 *
 * Given the last N months of transactions and existing budgets for the target
 * month, returns per-category suggestions with confidence scores.
 *
 * Monetary values in pennies throughout.
 */

const EXCLUDE_CATEGORIES = new Set(['Payments', 'Transfer', 'Investment', 'Debt Payment', 'Income']);

/**
 * @param {Object} opts
 * @param {Array} opts.transactions - transaction docs (must have `date` as ISO string or Date, `amount_pennies`, `category`)
 * @param {string} opts.targetMonth - YYYY-MM (e.g. "2026-05")
 * @param {number} [opts.lookbackMonths=3]
 * @param {Array} [opts.existingBudgets] - monthly_budget docs for the target month (with `category`, `amount_pennies`)
 * @returns {{suggestions: Array, analysis: Object}}
 */
export function generateSuggestions({
  transactions = [],
  targetMonth,
  lookbackMonths = 3,
  existingBudgets = [],
}) {
  const target = parseMonth(targetMonth);
  const windowStart = new Date(target);
  windowStart.setMonth(windowStart.getMonth() - lookbackMonths);

  // 1. Filter to outflows in the lookback window.
  const inWindow = transactions.filter((t) => {
    const d = toDate(t.date);
    return d >= windowStart && d < target && (Number(t.amount_pennies) || 0) < 0;
  });

  if (inWindow.length === 0) {
    return { suggestions: [], analysis: { transactionCount: 0, monthsAnalyzed: 0, categoriesFound: 0, totalSuggestedPennies: 0 } };
  }

  // 2. Group spending by category.
  const byCategory = new Map();
  const monthSet = new Set();
  for (const t of inWindow) {
    const cat = t.category || 'Other';
    const monthKey = toDate(t.date).toISOString().slice(0, 7);
    monthSet.add(monthKey);
    if (!byCategory.has(cat)) byCategory.set(cat, { total: 0, count: 0, months: new Set() });
    const entry = byCategory.get(cat);
    entry.total += Math.abs(Number(t.amount_pennies) || 0);
    entry.count += 1;
    entry.months.add(monthKey);
  }

  const monthsAnalyzed = monthSet.size || 1;

  // 3. Build suggestions with 10% variance buffer.
  const existingByCategory = new Map(
    (existingBudgets || []).map((b) => [b.category, b])
  );

  const suggestions = [];
  for (const [category, data] of byCategory.entries()) {
    if (EXCLUDE_CATEGORIES.has(category)) continue;
    const monthlyAvgPennies = data.total / monthsAnalyzed;
    const suggestedPennies = Math.ceil(monthlyAvgPennies * 1.1);

    const consistency = data.months.size / monthsAnalyzed;
    let confidence;
    if (consistency >= 0.8 && data.count >= 3) confidence = 'high';
    else if (consistency >= 0.5) confidence = 'medium';
    else confidence = 'low';

    const existing = existingByCategory.get(category);
    suggestions.push({
      category,
      monthly_average_pennies: Math.round(monthlyAvgPennies),
      suggested_amount_pennies: suggestedPennies,
      transaction_count: data.count,
      months_seen: data.months.size,
      confidence,
      already_budgeted: !!existing,
      current_allocation_pennies: existing ? Number(existing.amount_pennies) : null,
    });
  }

  suggestions.sort((a, b) => b.suggested_amount_pennies - a.suggested_amount_pennies);

  const totalSuggested = suggestions.reduce((s, x) => s + x.suggested_amount_pennies, 0);

  return {
    suggestions,
    analysis: {
      transactionCount: inWindow.length,
      monthsAnalyzed,
      categoriesFound: suggestions.length,
      totalSuggestedPennies: totalSuggested,
    },
  };
}

function parseMonth(s) {
  if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), 1);
  const m = /^(\d{4})-(\d{2})/.exec(String(s));
  if (!m) throw new Error(`Invalid targetMonth: ${s}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, 1);
}

function toDate(d) {
  if (d instanceof Date) return d;
  if (d && typeof d.toDate === 'function') return d.toDate();
  if (d && typeof d.seconds === 'number') return new Date(d.seconds * 1000);
  return new Date(d);
}
