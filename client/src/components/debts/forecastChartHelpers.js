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

/**
 * Merge balance snapshots onto the Projected chart rows so the Actual tab
 * can render dots per debt at the months where a snapshot was recorded.
 * Each debt gets a second key `${name}_actual` whose value is the snapshot
 * balance (in pounds), only present on months where that debt had a snapshot
 * — other months carry no key so Recharts can skip the dot.
 *
 * If multiple snapshots for the same debt fall in the same forecast month,
 * the latest one wins (so "20 Apr statement" beats "02 Apr statement").
 */
export function toActualChartData(months, debts, snapshots) {
  const rows = toProjectedChartData(months, debts);
  if (rows.length === 0 || !Array.isArray(snapshots) || snapshots.length === 0) return rows;

  const nameById = new Map(debts.map((d) => [d.id, d.name]));
  // Bucket snapshots into forecast rows using each row's start ms as the
  // boundary: a snapshot belongs to the latest row whose start ≤ snapshot.
  const forecastMonthMs = months.map((m) => parseMonthLabelToMs(m.month));

  // Per-debt, per-month → latest snapshot balance so far in that month.
  // We keep { ms, pennies } and overwrite when a later snapshot arrives in
  // the same bucket.
  const bestByKey = new Map();
  for (const s of snapshots) {
    const debtName = nameById.get(s.debt_id);
    if (!debtName) continue;
    const snapMs = toMillisLoose(s.as_of_date);
    if (!snapMs) continue;
    const rowIndex = bucketIndex(snapMs, forecastMonthMs);
    if (rowIndex < 0) continue;
    const key = `${rowIndex}|${debtName}`;
    const existing = bestByKey.get(key);
    if (!existing || snapMs > existing.ms) {
      bestByKey.set(key, { ms: snapMs, pennies: Number(s.balance_pennies || 0) });
    }
  }

  // Attach `${name}_actual` values onto the chart rows.
  return rows.map((row, rowIndex) => {
    const withActuals = { ...row };
    for (const debt of debts) {
      const key = `${rowIndex}|${debt.name}`;
      const snap = bestByKey.get(key);
      if (snap) withActuals[`${debt.name}_actual`] = snap.pennies / 100;
    }
    return withActuals;
  });
}

// Convert whatever date shape is on forecast.months (ISO string, Date, Timestamp)
// to epoch millis. Deliberately permissive — the engine owns the canonical
// shape but chart data may flow in from tests with different shapes.
function parseMonthLabelToMs(label) {
  if (label instanceof Date) return label.getTime();
  if (typeof label === 'string') {
    const t = new Date(label).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

function toMillisLoose(d) {
  if (!d) return 0;
  if (typeof d === 'number') return Number.isFinite(d) ? d : 0;
  if (d instanceof Date) return d.getTime();
  if (typeof d === 'string') {
    const t = new Date(d).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof d.toDate === 'function') return d.toDate().getTime();
  if (typeof d.seconds === 'number') return d.seconds * 1000;
  return 0;
}

// Given an array of forecast-month start-ms and a snapshot timestamp, return
// the index of the forecast row the snapshot belongs to (the latest row
// whose start ≤ snapshot). -1 if before all rows; last row if after all.
function bucketIndex(snapMs, forecastMonthMs) {
  if (!Number.isFinite(snapMs) || snapMs <= 0) return -1;
  if (forecastMonthMs.length === 0) return -1;
  if (snapMs < forecastMonthMs[0]) return -1;
  for (let i = forecastMonthMs.length - 1; i >= 0; i--) {
    if (snapMs >= forecastMonthMs[i]) return i;
  }
  return -1;
}

/**
 * Savings-tab chart data: cumulative interest saved vs a min-only baseline,
 * month by month. The min-only forecast usually runs longer than the active
 * plan, so we align on the active plan's month count; any min-only months
 * beyond that are omitted (the active plan already reached debt-free).
 */
export function toSavingsChartData(planMonths, minOnlyMonths) {
  if (!Array.isArray(planMonths) || planMonths.length === 0) return [];
  const rows = [];
  let planCum = 0;
  let minCum = 0;
  for (let i = 0; i < planMonths.length; i++) {
    planCum += Number(planMonths[i].interest_pennies || 0);
    const mm = minOnlyMonths?.[i];
    if (mm) minCum += Number(mm.interest_pennies || 0);
    const savedPennies = Math.max(0, minCum - planCum);
    rows.push({
      month: shortMonth(planMonths[i].month),
      savedPounds: savedPennies / 100,
    });
  }
  return rows;
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
