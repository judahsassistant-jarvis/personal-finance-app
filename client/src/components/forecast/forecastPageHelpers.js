import { penniesToPounds, LIQUIDITY } from '../../firebase/schema.js';

// Share the debt chart palette so both forecasts feel visually related. Ordered
// for top-of-legend distinctness: sky, orange, violet, emerald, red, yellow, etc.
export const LINE_COLORS = [
  '#0ea5e9', '#f97316', '#8b5cf6', '#10b981',
  '#ef4444', '#eab308', '#14b8a6', '#ec4899',
  '#6366f1', '#84cc16', '#d946ef', '#f59e0b',
];

export function shortMonth(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

/**
 * Turn runAccountForecast rows into Recharts-ready data keyed by account name.
 * Only emits columns for accounts present in `visibleIds`. Balances in pounds.
 *
 * The `total` key sums visible accounts only (so toggling one off drops it from
 * the aggregate line too). `liquid` / `locked` sums are keyed similarly.
 */
export function toAccountChartData(rows, accounts, visibleIds) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const visible = new Set(visibleIds ?? accounts.map((a) => a.id));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const nameForId = (id) => byId.get(id)?.name ?? id;

  return rows.map((r) => {
    const out = { month: shortMonth(r.date) };
    let total = 0, liquid = 0, locked = 0;
    for (const a of accounts) {
      if (!visible.has(a.id)) continue;
      const p = penniesToPounds(r.accounts[a.id] ?? 0);
      out[a.name] = p;
      total += p;
      if (a.liquidity === LIQUIDITY.LOCKED) locked += p;
      else liquid += p;
    }
    out.total = total;
    out.liquid = liquid;
    out.locked = locked;
    return out;
  });
}

/**
 * Build { key, color } line specs for each visible account. Consumers map
 * these into <Line dataKey={spec.key} stroke={spec.color} /> elements.
 */
export function accountSeriesSpecs(accounts, visibleIds) {
  const visible = new Set(visibleIds ?? accounts.map((a) => a.id));
  const ordered = accounts.filter((a) => visible.has(a.id));
  return ordered.map((a, i) => ({
    key: a.name,
    id: a.id,
    color: LINE_COLORS[i % LINE_COLORS.length],
  }));
}

export function getCurrentAge(birthYear, now = new Date()) {
  if (!birthYear) return null;
  const y = Number(birthYear);
  if (!Number.isFinite(y) || y < 1900 || y > now.getFullYear()) return null;
  return now.getFullYear() - y;
}
