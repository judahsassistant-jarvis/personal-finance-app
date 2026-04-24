import { describe, test, expect } from 'vitest';
import { applySingleTransfer, applyMultiAllocation } from '../whatIfEngine.js';
import { runForecast } from '../debtForecast.js';
import { DEBT_SUBTYPES } from '../../firebase/schema.js';

const now = new Date(2026, 4, 15); // May 15 2026

function newCardSpec(overrides = {}) {
  return {
    name: 'Test BT',
    standardApr: 0.219, // 21.9% post-promo
    promoApr: 0,
    promoMonths: 12,
    feePercent: 0.03, // 3%
    ...overrides,
  };
}

describe('applySingleTransfer', () => {
  test('reduces a card source\'s highest-APR bucket first', () => {
    const debts = [{ id: 'card', subtype: DEBT_SUBTYPES.CARD, name: 'Card', user_id: 'u', standard_apr: 0.249 }];
    const buckets = [
      { id: 'b1', debt_id: 'card', name: 'Standard', balance_pennies: 200000, apr: 0.249 },
      { id: 'b2', debt_id: 'card', name: 'Promo', balance_pennies: 300000, apr: 0 },
    ];
    const out = applySingleTransfer({ debts, buckets }, {
      sourceDebtId: 'card',
      transferPennies: 150000,
      newCard: newCardSpec(),
      now,
    });
    const b1 = out.buckets.find((b) => b.id === 'b1');
    const b2 = out.buckets.find((b) => b.id === 'b2');
    expect(b1.balance_pennies).toBe(50000); // 200000 - 150000
    expect(b2.balance_pennies).toBe(300000); // untouched
  });

  test('drains across buckets when transfer exceeds top bucket', () => {
    const debts = [{ id: 'card', subtype: DEBT_SUBTYPES.CARD, user_id: 'u', standard_apr: 0.249 }];
    const buckets = [
      { id: 'b1', debt_id: 'card', balance_pennies: 100000, apr: 0.249 },
      { id: 'b2', debt_id: 'card', balance_pennies: 200000, apr: 0 },
    ];
    const out = applySingleTransfer({ debts, buckets }, {
      sourceDebtId: 'card',
      transferPennies: 250000,
      newCard: newCardSpec(),
      now,
    });
    expect(out.buckets.find((b) => b.id === 'b1').balance_pennies).toBe(0);
    expect(out.buckets.find((b) => b.id === 'b2').balance_pennies).toBe(50000);
  });

  test('clamps transfer to the source\'s total balance', () => {
    const debts = [{ id: 'loan', subtype: DEBT_SUBTYPES.PERSONAL_LOAN, user_id: 'u', balance_pennies: 100000, standard_apr: 0.10 }];
    const out = applySingleTransfer({ debts, buckets: [] }, {
      sourceDebtId: 'loan',
      transferPennies: 999999,
      newCard: newCardSpec(),
      now,
    });
    expect(out.transfer.transferPennies).toBe(100000);
    expect(out.debts.find((d) => d.id === 'loan').balance_pennies).toBe(0);
  });

  test('reduces an installment debt\'s balance directly', () => {
    const debts = [{ id: 'loan', subtype: DEBT_SUBTYPES.PERSONAL_LOAN, user_id: 'u', balance_pennies: 500000, standard_apr: 0.10 }];
    const out = applySingleTransfer({ debts, buckets: [] }, {
      sourceDebtId: 'loan',
      transferPennies: 200000,
      newCard: newCardSpec(),
      now,
    });
    expect(out.debts.find((d) => d.id === 'loan').balance_pennies).toBe(300000);
  });

  test('adds a synthetic BT card with one bucket containing transfer + fee', () => {
    const debts = [{ id: 'card', subtype: DEBT_SUBTYPES.CARD, user_id: 'u', standard_apr: 0.249 }];
    const buckets = [{ id: 'b1', debt_id: 'card', balance_pennies: 100000, apr: 0.249 }];
    const out = applySingleTransfer({ debts, buckets }, {
      sourceDebtId: 'card',
      transferPennies: 100000,
      newCard: newCardSpec(),
      now,
    });
    const newCard = out.debts.find((d) => d._synthetic);
    const newBucket = out.buckets.find((b) => b._synthetic);
    expect(newCard.subtype).toBe(DEBT_SUBTYPES.CARD);
    expect(newCard.standard_apr).toBe(0.219);
    expect(newBucket.debt_id).toBe(newCard.id);
    expect(newBucket.balance_pennies).toBe(103000); // 100000 + 3% fee
    expect(newBucket.is_promo).toBe(true);
    expect(newBucket.apr).toBe(0);
  });

  test('promo_end is set N months from `now`', () => {
    const debts = [{ id: 'card', subtype: DEBT_SUBTYPES.CARD, user_id: 'u', standard_apr: 0.249 }];
    const buckets = [{ id: 'b1', debt_id: 'card', balance_pennies: 100000, apr: 0.249 }];
    const out = applySingleTransfer({ debts, buckets }, {
      sourceDebtId: 'card',
      transferPennies: 50000,
      newCard: newCardSpec({ promoMonths: 18 }),
      now: new Date(2026, 4, 15),
    });
    const newBucket = out.buckets.find((b) => b._synthetic);
    expect(newBucket.promo_end.getFullYear()).toBe(2027);
    expect(newBucket.promo_end.getMonth()).toBe(10); // November
  });

  test('promoMonths=0 → no promo flag, bucket carries the new card\'s post-promo APR via parent', () => {
    const debts = [{ id: 'card', subtype: DEBT_SUBTYPES.CARD, user_id: 'u', standard_apr: 0.249 }];
    const buckets = [{ id: 'b1', debt_id: 'card', balance_pennies: 100000, apr: 0.249 }];
    const out = applySingleTransfer({ debts, buckets }, {
      sourceDebtId: 'card',
      transferPennies: 50000,
      newCard: newCardSpec({ promoMonths: 0 }),
      now,
    });
    const newBucket = out.buckets.find((b) => b._synthetic);
    expect(newBucket.is_promo).toBe(false);
    expect(newBucket.promo_end).toBeUndefined();
  });

  test('the modified state runs cleanly through runForecast and reduces interest vs baseline', () => {
    const debts = [{
      id: 'card', subtype: DEBT_SUBTYPES.CARD, user_id: 'u', name: 'Card',
      standard_apr: 0.249, min_percentage: 0.025, min_floor_pennies: 2500,
    }];
    const buckets = [{ id: 'b1', debt_id: 'card', name: 'Std', balance_pennies: 500000, apr: 0.249, is_promo: false }];

    const baseline = runForecast({ debts, buckets, startMonth: '2026-05-01', months: 60, monthlyBudget: 30000, strategy: 'avalanche' });
    const out = applySingleTransfer({ debts, buckets }, {
      sourceDebtId: 'card',
      transferPennies: 500000,
      newCard: newCardSpec({ promoMonths: 18, promoApr: 0, standardApr: 0.099, feePercent: 0.03 }),
      now: new Date(2026, 4, 1),
    });
    const withBt = runForecast({ debts: out.debts, buckets: out.buckets, startMonth: '2026-05-01', months: 60, monthlyBudget: 30000, strategy: 'avalanche' });

    expect(withBt.summary.totalInterestPennies).toBeLessThan(baseline.summary.totalInterestPennies);
  });
});

describe('applyMultiAllocation', () => {
  const buildState = () => ({
    debts: [
      { id: 'high', subtype: DEBT_SUBTYPES.CARD, user_id: 'u', standard_apr: 0.249 },
      { id: 'mid',  subtype: DEBT_SUBTYPES.CARD, user_id: 'u', standard_apr: 0.199 },
      { id: 'loan', subtype: DEBT_SUBTYPES.PERSONAL_LOAN, user_id: 'u', balance_pennies: 200000, standard_apr: 0.089 },
    ],
    buckets: [
      { id: 'high-b', debt_id: 'high', balance_pennies: 100000, apr: 0.249 },
      { id: 'mid-b',  debt_id: 'mid',  balance_pennies: 200000, apr: 0.199 },
    ],
  });

  test('greedy by APR descending — highest-APR debt is fully transferred first', () => {
    const out = applyMultiAllocation(buildState(), {
      availableLimitPennies: 250000,
      eligibleDebtIds: ['high', 'mid', 'loan'],
      newCard: newCardSpec(),
      now,
    });
    expect(out.allocations[0].debt_id).toBe('high');
    expect(out.allocations[0].transferred_pennies).toBe(100000);
    expect(out.allocations[1].debt_id).toBe('mid');
    expect(out.allocations[1].transferred_pennies).toBe(150000); // remaining cap after high
  });

  test('skips debts whose APR is at or below the BT promo APR (no value)', () => {
    const out = applyMultiAllocation(buildState(), {
      availableLimitPennies: 1_000_000,
      eligibleDebtIds: ['high', 'mid', 'loan'],
      newCard: newCardSpec({ promoApr: 0.10 }), // 10% promo — loan at 8.9% is not worth transferring
      now,
    });
    const ids = out.allocations.map((a) => a.debt_id);
    expect(ids).toContain('high');
    expect(ids).toContain('mid');
    expect(ids).not.toContain('loan');
  });

  test('skips debts not in the eligible set', () => {
    const out = applyMultiAllocation(buildState(), {
      availableLimitPennies: 1_000_000,
      eligibleDebtIds: ['high'], // user only opted in the high-APR card
      newCard: newCardSpec(),
      now,
    });
    expect(out.allocations).toHaveLength(1);
    expect(out.allocations[0].debt_id).toBe('high');
  });

  test('allocates exactly the available limit when total balances exceed it', () => {
    const out = applyMultiAllocation(buildState(), {
      availableLimitPennies: 50000,
      eligibleDebtIds: ['high', 'mid', 'loan'],
      newCard: newCardSpec(),
      now,
    });
    const total = out.allocations.reduce((s, a) => s + a.transferred_pennies, 0);
    expect(total).toBe(50000);
  });

  test('returns an empty allocation list when no debts are eligible', () => {
    const out = applyMultiAllocation(buildState(), {
      availableLimitPennies: 1_000_000,
      eligibleDebtIds: [],
      newCard: newCardSpec(),
      now,
    });
    expect(out.allocations).toEqual([]);
    expect(out.transfer.totalTransferPennies).toBe(0);
  });

  test('the new BT card carries the sum of all transfers + total fee', () => {
    const out = applyMultiAllocation(buildState(), {
      availableLimitPennies: 250000,
      eligibleDebtIds: ['high', 'mid', 'loan'],
      newCard: newCardSpec({ feePercent: 0.04 }),
      now,
    });
    const newBucket = out.buckets.find((b) => b._synthetic);
    // 250_000 transferred + 4% fee = 260_000
    expect(newBucket.balance_pennies).toBe(260000);
  });

  test('ranks by bucket APR, not headline card APR — skips zero-interest promo balances', () => {
    // Like the real Barclaycard / Virgin / Zempler scenario: Barclaycard has a
    // high headline APR but the full balance sits in an active 0% promo bucket,
    // so transferring from there saves nothing (and wastes the BT fee). Virgin
    // has a lower headline APR but real interest-bearing balance.
    const debts = [
      { id: 'barclay', subtype: DEBT_SUBTYPES.CARD, user_id: 'u', standard_apr: 0.28 },
      { id: 'virgin',  subtype: DEBT_SUBTYPES.CARD, user_id: 'u', standard_apr: 0.241 },
      { id: 'zempler', subtype: DEBT_SUBTYPES.CARD, user_id: 'u', standard_apr: 0.377 },
    ];
    const buckets = [
      { id: 'barclay-promo', debt_id: 'barclay', balance_pennies: 609357, apr: 0, is_promo: true },
      { id: 'virgin-std',    debt_id: 'virgin',  balance_pennies: 129136, apr: 0.241 },
      { id: 'zempler-std',   debt_id: 'zempler', balance_pennies: 180296, apr: 0.377 },
    ];
    const out = applyMultiAllocation({ debts, buckets }, {
      availableLimitPennies: 200000, // £2,000
      eligibleDebtIds: ['barclay', 'virgin', 'zempler'],
      newCard: newCardSpec(),
      now,
    });
    const ids = out.allocations.map((a) => a.debt_id);
    expect(ids).toEqual(['zempler', 'virgin']);
    expect(out.allocations[0].transferred_pennies).toBe(180296);
    expect(out.allocations[1].transferred_pennies).toBe(19704); // 200000 - 180296
    expect(ids).not.toContain('barclay');
    // Barclay's 0% bucket must be untouched.
    expect(out.buckets.find((b) => b.id === 'barclay-promo').balance_pennies).toBe(609357);
  });

  test('source card buckets are reduced highest-APR first per debt', () => {
    const debts = [{ id: 'card', subtype: DEBT_SUBTYPES.CARD, user_id: 'u', standard_apr: 0.249 }];
    const buckets = [
      { id: 'b-high', debt_id: 'card', balance_pennies: 50000, apr: 0.249 },
      { id: 'b-low',  debt_id: 'card', balance_pennies: 50000, apr: 0 },
    ];
    const out = applyMultiAllocation({ debts, buckets }, {
      availableLimitPennies: 30000,
      eligibleDebtIds: ['card'],
      newCard: newCardSpec(),
      now,
    });
    expect(out.buckets.find((b) => b.id === 'b-high').balance_pennies).toBe(20000);
    expect(out.buckets.find((b) => b.id === 'b-low').balance_pennies).toBe(50000);
  });
});
