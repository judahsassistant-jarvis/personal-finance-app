/**
 * Account Forecast Engine — multi-account projection.
 *
 * Pure function. No Firestore / no IO. The caller passes accounts + options;
 * the engine returns monthly balance rows.
 *
 * Algorithm per month, per account:
 *   1. Grow: balance *= (1 + monthly_rate)
 *      - liquid subtypes: monthly_rate = interest_rate / 12
 *      - locked subtypes: monthly_rate = growth_rate / 12
 *   2. Contribute: balance += monthly_contribution_pennies (if any)
 *   3. Scenario: balance += scenario_allocation (if account is targeted)
 *
 * Monetary values: pennies (Number on input; float internally to carry
 * sub-penny precision through compounding; rounded to integer on row emit).
 */

import { ACCOUNT_SUBTYPES } from '../firebase/schema.js';

/**
 * Annual rate chosen per account subtype. liquid → interest_rate; locked →
 * growth_rate. Current accounts default to 0 even when a rate is populated on
 * the doc (current balance doesn't compound in any meaningful way).
 */
export function getAnnualRate(account) {
  if (!account) return 0;
  if (account.subtype === ACCOUNT_SUBTYPES.CURRENT) return 0;
  const rate = account.interest_rate ?? account.growth_rate ?? 0;
  return Number.isFinite(Number(rate)) ? Number(rate) : 0;
}

export function getMonthlyRate(account) {
  return getAnnualRate(account) / 12;
}

/**
 * @param {Object} input
 * @param {Array} input.accounts - AccountDoc[] with id, balance_pennies, interest/growth rate, monthly_contribution_pennies
 * @param {number} [input.months=12] - projection horizon
 * @param {Object} [input.scenario] - { extraContributionPennies, accountIds }: the scenario's
 *   total extra contribution is split equally across accountIds every month.
 * @param {Date} [input.startDate] - first row (month 0); defaults to current-month first-day
 * @returns {{ rows: Array<{ index, date, total_pennies, accounts: Record<string, number> }> }}
 */
export function runAccountForecast({ accounts = [], months = 12, scenario = null, startDate } = {}) {
  const horizon = Math.max(0, Math.floor(months));
  const now = startDate instanceof Date ? startDate : new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const balances = {};
  for (const a of accounts) {
    balances[a.id] = Number(a.balance_pennies ?? 0);
  }

  const scenarioTargets = Array.isArray(scenario?.accountIds) ? scenario.accountIds : [];
  const scenarioExtra = Number(scenario?.extraContributionPennies ?? 0);
  const scenarioPerAccount = scenarioTargets.length > 0 && scenarioExtra > 0
    ? scenarioExtra / scenarioTargets.length
    : 0;
  const scenarioSet = new Set(scenarioTargets);

  const rows = [emitRow(0, startMonth, balances, accounts)];

  for (let i = 1; i <= horizon; i++) {
    const d = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
    for (const a of accounts) {
      let bal = balances[a.id];
      const rate = getMonthlyRate(a);
      bal = bal * (1 + rate);
      bal += Number(a.monthly_contribution_pennies ?? 0);
      if (scenarioSet.has(a.id)) bal += scenarioPerAccount;
      balances[a.id] = bal;
    }
    rows.push(emitRow(i, d, balances, accounts));
  }

  return { rows };
}

function emitRow(index, date, balances, accounts) {
  const per = {};
  let total = 0;
  for (const a of accounts) {
    const b = Math.round(balances[a.id] ?? 0);
    per[a.id] = b;
    total += b;
  }
  return { index, date, total_pennies: total, accounts: per };
}

/**
 * Compute projection horizon in months. When `qualifyingAccounts` contains at
 * least one account AND `birthYear` is known, extend horizon far enough to
 * reach the max qualifying age across those accounts. Otherwise use default.
 * Horizon is always at least `defaultMonths`.
 *
 * Used twice on the Forecast page: once with SIPP accounts / `sipp_age`, and
 * once with Pension accounts / `pension_age`.
 *
 * @param {Object} input
 * @param {number} [input.defaultMonths=12]
 * @param {Array} [input.qualifyingAccounts=[]] - accounts to consider
 * @param {string} [input.ageField='sipp_age'] - which field on each account holds the qualifying age
 * @param {number} [input.defaultAge=57] - fallback when an account has no explicit age
 * @param {number} [input.birthYear] - from users/{uid}.birth_year
 * @param {Date} [input.now]
 */
export function computeHorizonMonths({
  defaultMonths = 12,
  qualifyingAccounts = [],
  ageField = 'sipp_age',
  defaultAge = 57,
  birthYear = null,
  now = new Date(),
} = {}) {
  if (!qualifyingAccounts.length || !birthYear) return defaultMonths;
  const currentAge = now.getFullYear() - Number(birthYear);
  const qualifyingAge = Math.max(...qualifyingAccounts.map((a) => Number(a[ageField] ?? defaultAge)));
  const yearsToQualify = Math.max(0, qualifyingAge - currentAge);
  return Math.max(defaultMonths, yearsToQualify * 12);
}

/**
 * Aggregate balances per liquidity bucket (liquid / locked) at a given row.
 * Useful for the net-worth view's split.
 */
export function splitByLiquidity(row, accounts) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  let liquid = 0;
  let locked = 0;
  for (const [id, bal] of Object.entries(row.accounts ?? {})) {
    const a = byId.get(id);
    if (!a) continue;
    if (a.liquidity === 'locked') locked += bal;
    else liquid += bal;
  }
  return { liquid, locked, total: liquid + locked };
}
