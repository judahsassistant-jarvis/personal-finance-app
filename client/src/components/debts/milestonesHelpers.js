import { DEBT_SUBTYPES } from '../../firebase/schema.js';

// Subtype → human-readable category label for the "All X cleared by" rollup.
// Mirrors the group labels used in DebtPlanner so the milestones panel speaks
// the same language as the list above it.
const CATEGORY_LABEL = {
  [DEBT_SUBTYPES.CARD]: 'credit cards',
  [DEBT_SUBTYPES.STORE_CARD]: 'store cards',
  [DEBT_SUBTYPES.PERSONAL_LOAN]: 'personal loans',
  [DEBT_SUBTYPES.BNPL]: 'BNPL plans',
  [DEBT_SUBTYPES.OVERDRAFT]: 'overdrafts',
};

/**
 * Read forecast.payoffSchedules + forecast.months and produce the milestone
 * list for the panel. Everything the panel displays is derived here so the
 * component stays purely presentational.
 *
 * Returns:
 *   {
 *     debtFreeMonth: string | null,
 *     perCategory: [{ subtype, label, count, lastPayoffMonth }, ...],
 *     perDebt: [{ debtId, name, subtype, payoffMonth, totalInterestPennies }, ...],
 *     utilisationCrossings: [{ threshold: 0.75 | 0.50 | 0.30 | 0, month }, ...],
 *   }
 */
export function computeMilestones(forecast, debts) {
  if (!forecast) {
    return { debtFreeMonth: null, perCategory: [], perDebt: [], utilisationCrossings: [] };
  }
  const debtById = new Map(debts.map((d) => [d.id, d]));
  const perDebt = computePerDebtPayoffs(forecast.payoffSchedules, debtById);
  const perCategory = rollupPerCategory(perDebt);
  const utilisationCrossings = computeUtilisationCrossings(forecast.months, debts);
  return {
    debtFreeMonth: forecast.debtFreeMonth || null,
    perCategory,
    perDebt,
    utilisationCrossings,
  };
}

function computePerDebtPayoffs(payoffSchedules, debtById) {
  const rows = [];
  for (const p of payoffSchedules || []) {
    const debt = debtById.get(p.debt_id);
    if (!debt) continue;
    rows.push({
      debtId: p.debt_id,
      name: debt.name,
      subtype: debt.subtype,
      payoffMonth: p.payoff_month,
      totalInterestPennies: Number(p.total_interest_pennies || 0),
    });
  }
  rows.sort((a, b) => compareMonth(a.payoffMonth, b.payoffMonth));
  return rows;
}

function rollupPerCategory(perDebt) {
  const byCategory = new Map();
  for (const p of perDebt) {
    if (!byCategory.has(p.subtype)) byCategory.set(p.subtype, []);
    byCategory.get(p.subtype).push(p);
  }
  const out = [];
  for (const [subtype, items] of byCategory) {
    let latest = items[0];
    for (const p of items) {
      if (compareMonth(p.payoffMonth, latest.payoffMonth) > 0) latest = p;
    }
    out.push({
      subtype,
      label: CATEGORY_LABEL[subtype] ?? subtype,
      count: items.length,
      lastPayoffMonth: latest.payoffMonth,
    });
  }
  // Order by which category clears first.
  out.sort((a, b) => compareMonth(a.lastPayoffMonth, b.lastPayoffMonth));
  return out;
}

// Thresholds we report. 0 is treated specially — "all limited debts fully
// cleared" rather than "< 0% utilisation".
const UTIL_THRESHOLDS = [0.75, 0.50, 0.30];

/**
 * Walk the forecast months, compute aggregate utilisation each month, and
 * flag the first month each threshold is crossed downward (was >=, now <).
 * If the user *starts* below a threshold, we don't synthesize a milestone —
 * they're already there, it's not an achievement.
 *
 * 0% is treated separately: the first month all limited balances hit zero.
 */
export function computeUtilisationCrossings(months, debts) {
  const limited = debts.filter((d) => Number(d?.limit_pennies) > 0);
  const totalLimit = limited.reduce((s, d) => s + Number(d.limit_pennies), 0);
  if (totalLimit === 0 || !Array.isArray(months) || months.length === 0) return [];

  const limitedIds = new Set(limited.map((d) => d.id));
  const crossings = [];
  const hit = new Set();
  let prevUtil = null;

  for (const m of months) {
    const used = (m.per_debt || [])
      .filter((pd) => limitedIds.has(pd.debt_id))
      .reduce((s, pd) => s + Math.max(0, Number(pd.ending_pennies || 0)), 0);
    const util = used / totalLimit;

    if (prevUtil !== null) {
      for (const t of UTIL_THRESHOLDS) {
        if (!hit.has(t) && prevUtil >= t && util < t) {
          crossings.push({ threshold: t, month: m.month });
          hit.add(t);
        }
      }
      if (!hit.has(0) && prevUtil > 0 && util === 0) {
        crossings.push({ threshold: 0, month: m.month });
        hit.add(0);
      }
    }
    prevUtil = util;
  }

  return crossings;
}

// "YYYY-MM" lexical compare is safe with ISO-style labels. Used to order
// milestones by date without parsing.
function compareMonth(a, b) {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : 1;
}
