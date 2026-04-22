import { penniesToPounds } from '../../firebase/schema.js';

// Fixed palette for per-debt lines. Deliberately varied in hue so 5+ debts
// don't blur together. Ordered so the first few (your biggest debts) get the
// most distinct colours. If you ever exceed LINE_COLORS.length debts, we
// cycle — the visual gets noisier but doesn't break.
export const LINE_COLORS = [
  '#0ea5e9', // sky-500
  '#f97316', // orange-500
  '#8b5cf6', // violet-500
  '#10b981', // emerald-500
  '#ef4444', // red-500
  '#eab308', // yellow-500
  '#14b8a6', // teal-500
  '#ec4899', // pink-500
];

/**
 * Turn a runForecast result into chart rows for the Projected tab —
 * one row per month, one key per debt (by name) + a `total` key, values in
 * pounds. Recharts reads these directly.
 */
export function toProjectedChartData(months, debts) {
  if (!Array.isArray(months) || months.length === 0) return [];
  const nameById = new Map();
  for (const d of debts) nameById.set(d.id, d.name);

  return months.map((m) => {
    const row = {
      month: shortMonth(m.month),
      total: penniesToPounds(m.ending_debt_pennies || 0),
    };
    for (const pd of m.per_debt || []) {
      const name = nameById.get(pd.debt_id);
      if (!name) continue;
      row[name] = penniesToPounds(pd.ending_pennies || 0);
    }
    return row;
  });
}

/**
 * Projected-chart line specs — which debts have a line, and in what colour.
 * Kept separate from the row data so the component can zip them together
 * without re-deriving. Excludes debts that never carry a balance in the
 * projection (e.g. already paid off at start).
 */
export function projectedSeries(months, debts) {
  if (!Array.isArray(months) || months.length === 0) return [];
  const everCarriedBalance = new Set();
  for (const m of months) {
    for (const pd of m.per_debt || []) {
      if (Number(pd.ending_pennies) > 0 || Number(pd.beginning_pennies) > 0) {
        everCarriedBalance.add(pd.debt_id);
      }
    }
  }
  return debts
    .filter((d) => everCarriedBalance.has(d.id))
    .map((d, i) => ({ key: d.name, color: LINE_COLORS[i % LINE_COLORS.length] }));
}

/**
 * Turn a runForecast result into chart rows for the Utilisation tab — total
 * utilisation percent across all debts that have a `limit_pennies` set (cards,
 * store cards, overdrafts). Installment debts don't have a meaningful limit
 * and are excluded.
 *
 * Returns { rows, eligibleDebtCount } so the UI can show an empty-state
 * message when the user has no debts with limits rather than rendering a
 * flat-zero chart.
 */
export function toUtilisationChartData(months, debts) {
  const limited = debts.filter((d) => Number(d?.limit_pennies) > 0);
  if (limited.length === 0 || !Array.isArray(months) || months.length === 0) {
    return { rows: [], eligibleDebtCount: limited.length };
  }

  const totalLimitPennies = limited.reduce((s, d) => s + Number(d.limit_pennies), 0);
  const limitedIds = new Set(limited.map((d) => d.id));

  const rows = months.map((m) => {
    const usedPennies = (m.per_debt || [])
      .filter((pd) => limitedIds.has(pd.debt_id))
      .reduce((s, pd) => s + Math.max(0, Number(pd.ending_pennies || 0)), 0);
    // Two-decimal percent, capped at 200% so Recharts doesn't auto-scale
    // weirdly if the user is briefly over-limit somewhere in the projection.
    const pct = Math.min(200, Math.round((usedPennies / totalLimitPennies) * 10000) / 100);
    return { month: shortMonth(m.month), utilisation: pct };
  });

  return { rows, eligibleDebtCount: limited.length };
}

/** "2026-05-01" → "May '26". Recharts shows this on the X axis. */
export function shortMonth(monthLabel) {
  if (typeof monthLabel !== 'string' || monthLabel.length < 7) return monthLabel ?? '';
  const [y, m] = monthLabel.split('-');
  const date = new Date(Number(y), Number(m) - 1, 1);
  if (Number.isNaN(date.getTime())) return monthLabel;
  const mon = date.toLocaleDateString('en-GB', { month: 'short' });
  const yy = String(date.getFullYear()).slice(-2);
  return `${mon} '${yy}`;
}
