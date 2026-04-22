import { STRATEGIES, DEBT_SUBTYPES, SMALL_BALANCE_BOOST_THRESHOLD_PENNIES } from '../../firebase/schema.js';

/**
 * Given enriched debt rows (output of enrichDebt in debtPlannerHelpers.js),
 * return the order in which extra payments will be attacked under the given
 * strategy. BNPL is excluded (its fixed installment schedule disallows extra);
 * zero-balance debts are excluded.
 *
 * Rank metric:
 *   avalanche → blended effective APR desc  (matches what the row displays)
 *   snowball  → total balance asc
 *   hybrid    → blended APR desc with a flat boost for debts under £500
 *               (mirrors debtForecast.getHybridScore; the boost of 0.5 is
 *               equivalent to the engine's +50% APR push, which bumps
 *               quick-win debts above even high-APR ones)
 *
 * The forecast engine ranks by bucket for card-like debts, not by blended APR.
 * Using the displayed blended number here keeps the UI consistent — the list
 * and the strategy ranks sort by the same signal.
 */
export function rankForStrategy(rows, strategy) {
  let bnplCount = 0;
  let zeroBalanceCount = 0;
  const eligible = [];
  for (const row of rows) {
    if (row.debt.subtype === DEBT_SUBTYPES.BNPL) {
      bnplCount += 1;
      continue;
    }
    if (row.totalBalance <= 0) {
      zeroBalanceCount += 1;
      continue;
    }
    eligible.push(row);
  }

  const ranked = eligible.slice();
  if (strategy === STRATEGIES.SNOWBALL) {
    ranked.sort((a, b) => a.totalBalance - b.totalBalance);
  } else if (strategy === STRATEGIES.HYBRID) {
    ranked.sort((a, b) => hybridRankScore(b) - hybridRankScore(a));
  } else {
    ranked.sort((a, b) => (b.blendedApr ?? 0) - (a.blendedApr ?? 0));
  }

  return { ranked, bnplCount, zeroBalanceCount };
}

function hybridRankScore(row) {
  const apr = row.blendedApr ?? 0;
  const boost = row.totalBalance < SMALL_BALANCE_BOOST_THRESHOLD_PENNIES ? 0.5 : 0;
  return apr + boost;
}
