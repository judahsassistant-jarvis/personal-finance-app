import { describe, it, expect } from 'vitest';
import { STRATEGIES, DEBT_SUBTYPES } from '../../../firebase/schema.js';
import { rankForStrategy } from '../strategyHelpers.js';

function makeRow({ id, subtype = DEBT_SUBTYPES.CARD, name = id, totalBalance, blendedApr = 0, priority = false }) {
  return {
    debt: { id, subtype, name, priority },
    totalBalance,
    blendedApr,
    buckets: [],
    min: 0,
    promo: null,
  };
}

describe('rankForStrategy', () => {
  it('avalanche sorts by blendedApr desc', () => {
    const rows = [
      makeRow({ id: 'a', blendedApr: 0.2, totalBalance: 100 }),
      makeRow({ id: 'b', blendedApr: 0.4, totalBalance: 100 }),
      makeRow({ id: 'c', blendedApr: 0.1, totalBalance: 100 }),
    ];
    const { ranked } = rankForStrategy(rows, STRATEGIES.AVALANCHE);
    expect(ranked.map((r) => r.debt.id)).toEqual(['b', 'a', 'c']);
  });

  it('snowball sorts by totalBalance asc', () => {
    const rows = [
      makeRow({ id: 'a', blendedApr: 0.2, totalBalance: 500 }),
      makeRow({ id: 'b', blendedApr: 0.2, totalBalance: 100 }),
      makeRow({ id: 'c', blendedApr: 0.2, totalBalance: 300 }),
    ];
    const { ranked } = rankForStrategy(rows, STRATEGIES.SNOWBALL);
    expect(ranked.map((r) => r.debt.id)).toEqual(['b', 'c', 'a']);
  });

  it('excludes BNPL debts and counts them', () => {
    const rows = [
      makeRow({ id: 'bnpl', subtype: DEBT_SUBTYPES.BNPL, totalBalance: 500 }),
      makeRow({ id: 'card', totalBalance: 100, blendedApr: 0.2 }),
    ];
    const { ranked, bnplCount } = rankForStrategy(rows, STRATEGIES.AVALANCHE);
    expect(ranked.map((r) => r.debt.id)).toEqual(['card']);
    expect(bnplCount).toBe(1);
  });

  it('excludes zero-balance debts and counts them', () => {
    const rows = [
      makeRow({ id: 'overdraft', subtype: DEBT_SUBTYPES.OVERDRAFT, totalBalance: 0 }),
      makeRow({ id: 'card', totalBalance: 100, blendedApr: 0.2 }),
    ];
    const { ranked, zeroBalanceCount } = rankForStrategy(rows, STRATEGIES.AVALANCHE);
    expect(ranked.map((r) => r.debt.id)).toEqual(['card']);
    expect(zeroBalanceCount).toBe(1);
  });

  it('returns empty ranked list when nothing eligible', () => {
    const rows = [
      makeRow({ id: 'bnpl', subtype: DEBT_SUBTYPES.BNPL, totalBalance: 500 }),
      makeRow({ id: 'zero', totalBalance: 0 }),
    ];
    const { ranked, bnplCount, zeroBalanceCount } = rankForStrategy(rows, STRATEGIES.AVALANCHE);
    expect(ranked).toEqual([]);
    expect(bnplCount).toBe(1);
    expect(zeroBalanceCount).toBe(1);
  });

  describe('hybrid', () => {
    it('orders by APR desc when no debt qualifies for the small-balance boost', () => {
      const rows = [
        makeRow({ id: 'low', blendedApr: 0.1, totalBalance: 100000 }),
        makeRow({ id: 'high', blendedApr: 0.4, totalBalance: 100000 }),
        makeRow({ id: 'mid', blendedApr: 0.2, totalBalance: 100000 }),
      ];
      const { ranked } = rankForStrategy(rows, STRATEGIES.HYBRID);
      expect(ranked.map((r) => r.debt.id)).toEqual(['high', 'mid', 'low']);
    });

    it('boosts a debt under £500 above a higher-APR debt', () => {
      // small debt £400 @ 10% APR should outrank £5,000 @ 40% APR under hybrid
      const rows = [
        makeRow({ id: 'big_high_apr', blendedApr: 0.4, totalBalance: 500000 }),
        makeRow({ id: 'small_low_apr', blendedApr: 0.1, totalBalance: 40000 }),
      ];
      const { ranked } = rankForStrategy(rows, STRATEGIES.HYBRID);
      expect(ranked.map((r) => r.debt.id)).toEqual(['small_low_apr', 'big_high_apr']);
    });

    it('does not boost a debt exactly at the £500 threshold', () => {
      // threshold is strict less-than, so 50_000 pennies (£500) is NOT boosted
      const rows = [
        makeRow({ id: 'at_threshold', blendedApr: 0.05, totalBalance: 50000 }),
        makeRow({ id: 'higher_apr', blendedApr: 0.3, totalBalance: 300000 }),
      ];
      const { ranked } = rankForStrategy(rows, STRATEGIES.HYBRID);
      expect(ranked.map((r) => r.debt.id)).toEqual(['higher_apr', 'at_threshold']);
    });

    it('orders two boosted small debts by APR desc among themselves', () => {
      const rows = [
        makeRow({ id: 'small_10apr', blendedApr: 0.1, totalBalance: 20000 }),
        makeRow({ id: 'small_25apr', blendedApr: 0.25, totalBalance: 30000 }),
      ];
      const { ranked } = rankForStrategy(rows, STRATEGIES.HYBRID);
      expect(ranked.map((r) => r.debt.id)).toEqual(['small_25apr', 'small_10apr']);
    });
  });
});
