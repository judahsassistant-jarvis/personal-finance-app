/**
 * Pure helpers for the Budgets page. Compute spend-by-category for a target
 * month from the user's transaction list, merge with existing budgets and
 * generated suggestions to produce display rows.
 *
 * Same EXCLUDE_CATEGORIES list as the suggestion engine — categories that
 * shift balance rather than spending (Transfer / Investment / Payments) and
 * inflows (Income) don't belong in a "what did I spend" view.
 */

export const EXCLUDE_FROM_BUDGETS = new Set([
  'Payments', 'Transfer', 'Investment', 'Debt Payment', 'Income',
]);

/**
 * Sum outflow transactions per category for `targetMonth` (YYYY-MM).
 * Excluded categories are filtered out. Returns Map<category, pennies>.
 */
export function computeSpendByCategory(transactions, targetMonth) {
  if (!targetMonth) return new Map();
  const m = /^(\d{4})-(\d{2})$/.exec(String(targetMonth));
  if (!m) return new Map();
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const start = new Date(year, month, 1).getTime();
  const end = new Date(year, month + 1, 1).getTime();

  const out = new Map();
  for (const t of transactions || []) {
    const amt = Number(t.amount_pennies || 0);
    if (amt >= 0) continue;
    const ms = toMillis(t.date);
    if (ms == null || ms < start || ms >= end) continue;
    const cat = t.category || 'Other';
    if (EXCLUDE_FROM_BUDGETS.has(cat)) continue;
    out.set(cat, (out.get(cat) || 0) + Math.abs(amt));
  }
  return out;
}

/**
 * Build display rows for the Budgets page. One row per category, merging:
 * - Spend this month (computed)
 * - Existing budget for this month (from monthly_budgets, if any)
 * - Suggestion (from generateSuggestions output, if any)
 *
 * Categories shown: union of (spent, has-budget, has-suggestion, all
 * `availableCategories` minus the EXCLUDE list). Rows sorted by spend desc
 * then by category name.
 *
 * @param {Object} opts
 * @param {Map<string, number>} opts.spendByCategory
 * @param {Array} opts.budgets - monthly_budget docs filtered to target month
 * @param {Array} opts.suggestions - generateSuggestions().suggestions output
 * @param {Array<string>} opts.availableCategories - KNOWN_CATEGORIES + custom
 */
export function buildBudgetRows({
  spendByCategory,
  budgets = [],
  suggestions = [],
  availableCategories = [],
}) {
  const budgetByCat = new Map();
  for (const b of budgets) {
    budgetByCat.set(b.category, b);
  }
  const suggestionByCat = new Map();
  for (const s of suggestions) {
    suggestionByCat.set(s.category, s);
  }

  const cats = new Set();
  for (const c of spendByCategory.keys()) cats.add(c);
  for (const b of budgets) cats.add(b.category);
  for (const s of suggestions) cats.add(s.category);
  for (const c of availableCategories) {
    if (!EXCLUDE_FROM_BUDGETS.has(c)) cats.add(c);
  }

  const rows = [];
  for (const category of cats) {
    if (EXCLUDE_FROM_BUDGETS.has(category)) continue;
    const spent = spendByCategory.get(category) || 0;
    const budget = budgetByCat.get(category) || null;
    const budgetPennies = budget ? Number(budget.amount_pennies || 0) : null;
    const suggestion = suggestionByCat.get(category) || null;
    rows.push({
      category,
      spent_pennies: spent,
      budget_id: budget?.id ?? null,
      budget_pennies: budgetPennies,
      remaining_pennies: budgetPennies != null ? budgetPennies - spent : null,
      utilisation: budgetPennies && budgetPennies > 0 ? spent / budgetPennies : null,
      suggestion_pennies: suggestion?.suggested_amount_pennies ?? null,
      suggestion_confidence: suggestion?.confidence ?? null,
    });
  }
  rows.sort((a, b) => {
    if (b.spent_pennies !== a.spent_pennies) return b.spent_pennies - a.spent_pennies;
    return a.category.localeCompare(b.category);
  });
  return rows;
}

/**
 * Aggregate totals for the page header tile.
 * @param {Array} rows - buildBudgetRows output
 */
export function computeBudgetTotals(rows) {
  let totalSpent = 0;
  let totalBudget = 0;
  let budgetedCount = 0;
  for (const r of rows) {
    totalSpent += r.spent_pennies;
    if (r.budget_pennies != null) {
      totalBudget += r.budget_pennies;
      budgetedCount += 1;
    }
  }
  return {
    total_spent_pennies: totalSpent,
    total_budget_pennies: totalBudget,
    total_remaining_pennies: totalBudget - totalSpent,
    budgeted_category_count: budgetedCount,
    total_category_count: rows.length,
  };
}

/** Current YYYY-MM in local time. */
export function currentMonthKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Step a YYYY-MM key by N months (positive forward, negative back). */
export function shiftMonth(monthKey, delta) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(monthKey));
  if (!m) return monthKey;
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Render a YYYY-MM key as "April 2026" for the page header. */
export function formatMonthHeader(monthKey) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(monthKey));
  if (!m) return monthKey;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return d.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
}

function toMillis(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const d = new Date(v);
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof v.toDate === 'function') {
    try { return v.toDate().getTime(); } catch (_) { return null; }
  }
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return null;
}
