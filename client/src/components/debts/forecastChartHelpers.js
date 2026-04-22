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
 * Build chart rows for the Actual-vs-Projected tab, treating each debt's
 * history as a single trajectory that transitions from actuals (past, solid)
 * to projected (future, dashed) at the forecast start.
 *
 * Timeline = every distinct YYYY-MM that has either a snapshot or a forecast
 * row, sorted chronologically. Per row, per debt:
 *   - `${name}_actual`    — latest snapshot balance in this month (if any)
 *   - `${name}_projected` — forecast ending balance for this month (if any)
 *
 * The chart component renders two Lines per debt sharing a colour: solid for
 * the actual series, dashed for the projected. Where both have a value in
 * the same month the lines meet visually — that's the transition point.
 *
 * When multiple snapshots for the same debt fall in the same month, the
 * latest one wins (so "20 Apr statement" beats "02 Apr statement").
 */
export function toActualVsProjectedChartData(months, debts, snapshots) {
  // Per-debt, per-YYYY-MM → latest snapshot balance in that month.
  const snapByKey = new Map();
  for (const s of snapshots || []) {
    const ms = toMillisLoose(s.as_of_date);
    if (!ms) continue;
    const ym = yearMonth(new Date(ms));
    const key = `${s.debt_id}|${ym}`;
    const existing = snapByKey.get(key);
    if (!existing || ms > existing.ms) {
      snapByKey.set(key, { ms, pennies: Number(s.balance_pennies || 0) });
    }
  }

  // YYYY-MM → forecast month row, for quick lookup during row assembly.
  // We also remember which YYYY-MM is the FIRST forecast row — that's the
  // transition point where actuals hand off to projected, and both series
  // need to carry the same value there so the lines visually meet.
  const forecastByYm = new Map();
  let firstForecastYm = null;
  for (const m of months || []) {
    const ms = parseMonthLabelToMs(m.month);
    if (!ms) continue;
    const ym = yearMonth(new Date(ms));
    if (firstForecastYm === null) firstForecastYm = ym;
    forecastByYm.set(ym, m);
  }

  // All months that need a row: every snapshot month + every forecast month.
  const allMonths = new Set([...snapByKey.keys()].map((k) => k.split('|')[1]));
  for (const ym of forecastByYm.keys()) allMonths.add(ym);
  const sortedYms = Array.from(allMonths).sort();

  // Build the rows. The label uses shortMonth's YY format to match the
  // Projected + Utilisation tabs so users don't see two date conventions
  // across the four tabs.
  const rows = sortedYms.map((ym) => {
    const row = { month: shortMonthFromYm(ym) };
    const fm = forecastByYm.get(ym);
    const isTransition = ym === firstForecastYm;

    for (const debt of debts || []) {
      const snap = snapByKey.get(`${debt.id}|${ym}`);
      const pd = fm ? (fm.per_debt || []).find((p) => p.debt_id === debt.id) : null;

      if (isTransition) {
        // At the transition month BOTH series carry the same value so solid
        // (actual) and dashed (projected) lines meet. Snapshot in this month
        // wins (it's more specific); otherwise fall back to the forecast's
        // beginning-of-month balance, which == current balance == latest
        // snapshot (RecordSnapshotForm keeps the two in sync on save).
        const currentPennies = snap
          ? snap.pennies
          : Number(pd?.beginning_pennies || 0);
        row[`${debt.name}_actual`] = currentPennies / 100;
        row[`${debt.name}_projected`] = currentPennies / 100;
      } else if (pd) {
        // Future forecast month: projected only.
        row[`${debt.name}_projected`] = Number(pd.ending_pennies || 0) / 100;
      } else if (snap) {
        // Past snapshot month with no forecast row: actual only.
        row[`${debt.name}_actual`] = snap.pennies / 100;
      }
    }
    return row;
  });
  return rows;
}

function yearMonth(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function shortMonthFromYm(ym) {
  const [y, m] = ym.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return ym;
  const d = new Date(y, m - 1, 1);
  const mon = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${mon} '${String(y).slice(-2)}`;
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

/**
 * Savings-tab chart data: cumulative interest saved vs a min-only baseline,
 * month by month.
 *
 * Most of the savings accrue AFTER the active plan is paid off — the plan
 * stops accruing interest (user is debt-free) while min-only keeps paying.
 * So we iterate to the max length of either forecast; months where one side
 * has run out contribute 0 to that side's cumulative. Month labels come from
 * whichever array is longer so the X axis spans the full comparison window.
 */
export function toSavingsChartData(planMonths, minOnlyMonths) {
  const planLen = Array.isArray(planMonths) ? planMonths.length : 0;
  const minLen = Array.isArray(minOnlyMonths) ? minOnlyMonths.length : 0;
  const maxLen = Math.max(planLen, minLen);
  if (maxLen === 0) return [];
  const labelSource = minLen >= planLen ? minOnlyMonths : planMonths;

  const rows = [];
  let planCum = 0;
  let minCum = 0;
  for (let i = 0; i < maxLen; i++) {
    planCum += Number(planMonths?.[i]?.interest_pennies || 0);
    minCum += Number(minOnlyMonths?.[i]?.interest_pennies || 0);
    const savedPennies = Math.max(0, minCum - planCum);
    rows.push({
      month: shortMonth(labelSource[i].month),
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
