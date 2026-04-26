import { describe, test, expect } from 'vitest';
import { findTransferPairs, indexPairsByTransaction, pairIdFor } from '../transferPairing.js';

function tx({ id, account, amount, date, ...rest }) {
  return {
    id,
    account_id: account,
    amount_pennies: Math.round(amount * 100),
    date,
    ...rest,
  };
}

describe('findTransferPairs', () => {
  test('pairs a same-day outflow + inflow on different accounts', () => {
    const txs = [
      tx({ id: 't1', account: 'a-nationwide', amount: -500, date: '2026-03-15' }),
      tx({ id: 't2', account: 'a-revolut', amount: 500, date: '2026-03-15' }),
    ];
    const pairs = findTransferPairs(txs);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      outflowId: 't1',
      inflowId: 't2',
      outflowAccountId: 'a-nationwide',
      inflowAccountId: 'a-revolut',
      amount_pennies: 50000,
    });
  });

  test('pairs across a 3-day delay (Friday→Monday clearance)', () => {
    const txs = [
      tx({ id: 't1', account: 'a', amount: -200, date: '2026-03-27' }),
      tx({ id: 't2', account: 'b', amount: 200, date: '2026-03-30' }),
    ];
    expect(findTransferPairs(txs)).toHaveLength(1);
  });

  test('does not pair beyond the date window', () => {
    const txs = [
      tx({ id: 't1', account: 'a', amount: -200, date: '2026-03-15' }),
      tx({ id: 't2', account: 'b', amount: 200, date: '2026-03-22' }),
    ];
    expect(findTransferPairs(txs)).toEqual([]);
  });

  test('does not pair within the same account', () => {
    const txs = [
      tx({ id: 't1', account: 'a', amount: -200, date: '2026-03-15' }),
      tx({ id: 't2', account: 'a', amount: 200, date: '2026-03-15' }),
    ];
    expect(findTransferPairs(txs)).toEqual([]);
  });

  test('suppresses ambiguous matches (multiple candidates of same amount)', () => {
    // Two £20 outflows from Nationwide + one £20 inflow on Revolut on the
    // same day → ambiguous which outflow paired with the inflow. Don't guess.
    const txs = [
      tx({ id: 'o1', account: 'nat', amount: -20, date: '2026-03-15' }),
      tx({ id: 'o2', account: 'nat', amount: -20, date: '2026-03-15' }),
      tx({ id: 'i1', account: 'rev', amount: 20, date: '2026-03-15' }),
    ];
    expect(findTransferPairs(txs)).toEqual([]);
  });

  test('suppresses pairs where dismissed sentinel is set', () => {
    const txs = [
      tx({ id: 't1', account: 'a', amount: -500, date: '2026-03-15', pair_dismissed_at: 12345 }),
      tx({ id: 't2', account: 'b', amount: 500, date: '2026-03-15' }),
    ];
    expect(findTransferPairs(txs)).toEqual([]);
  });

  test('suppresses pairs where one side already has transfer_pair_id', () => {
    const txs = [
      tx({ id: 't1', account: 'a', amount: -500, date: '2026-03-15', transfer_pair_id: 'old' }),
      tx({ id: 't2', account: 'b', amount: 500, date: '2026-03-15' }),
    ];
    expect(findTransferPairs(txs)).toEqual([]);
  });

  test('suppresses pairs where one side is a debt payment (debt_id set)', () => {
    // A repayment from Revolut to a Zopa debt would otherwise look like a
    // transfer (outflow Revolut + inflow Zopa-statement-import). debt_id
    // takes precedence — Debt Payment, not Transfer.
    const txs = [
      tx({ id: 't1', account: 'rev', amount: -650, date: '2026-03-15', debt_id: 'd-zopa' }),
      tx({ id: 't2', account: 'zopa', amount: 650, date: '2026-03-15' }),
    ];
    expect(findTransferPairs(txs)).toEqual([]);
  });

  test('zero-amount transactions never pair', () => {
    const txs = [
      tx({ id: 't1', account: 'a', amount: 0, date: '2026-03-15' }),
      tx({ id: 't2', account: 'b', amount: 0, date: '2026-03-15' }),
    ];
    expect(findTransferPairs(txs)).toEqual([]);
  });

  test('handles many distinct unambiguous pairs in one pass', () => {
    const txs = [
      tx({ id: 'o1', account: 'a', amount: -100, date: '2026-03-15' }),
      tx({ id: 'i1', account: 'b', amount: 100, date: '2026-03-15' }),
      tx({ id: 'o2', account: 'a', amount: -50, date: '2026-03-16' }),
      tx({ id: 'i2', account: 'c', amount: 50, date: '2026-03-17' }),
      tx({ id: 'o3', account: 'b', amount: -3200, date: '2026-04-09' }),
      tx({ id: 'i3', account: 'isa', amount: 3200, date: '2026-04-09' }),
    ];
    const pairs = findTransferPairs(txs);
    expect(pairs).toHaveLength(3);
    expect(pairs.map((p) => p.outflowId).sort()).toEqual(['o1', 'o2', 'o3']);
  });

  test('honours custom dateWindowDays', () => {
    const txs = [
      tx({ id: 't1', account: 'a', amount: -200, date: '2026-03-15' }),
      tx({ id: 't2', account: 'b', amount: 200, date: '2026-03-22' }),
    ];
    expect(findTransferPairs(txs, { dateWindowDays: 7 })).toHaveLength(1);
  });

  test('handles Firestore Timestamp-shaped dates ({ seconds })', () => {
    const epoch = (iso) => Math.floor(new Date(iso).getTime() / 1000);
    const txs = [
      tx({ id: 't1', account: 'a', amount: -500, date: { seconds: epoch('2026-03-15') } }),
      tx({ id: 't2', account: 'b', amount: 500, date: { seconds: epoch('2026-03-15') } }),
    ];
    expect(findTransferPairs(txs)).toHaveLength(1);
  });
});

describe('indexPairsByTransaction', () => {
  test('emits an entry for each side of every pair', () => {
    const pairs = [{ outflowId: 'o1', inflowId: 'i1', outflowAccountId: 'a', inflowAccountId: 'b', amount_pennies: 5000 }];
    const idx = indexPairsByTransaction(pairs);
    expect(idx.size).toBe(2);
    expect(idx.get('o1').role).toBe('outflow');
    expect(idx.get('o1').otherId).toBe('i1');
    expect(idx.get('o1').otherAccountId).toBe('b');
    expect(idx.get('i1').role).toBe('inflow');
    expect(idx.get('i1').otherId).toBe('o1');
    expect(idx.get('i1').otherAccountId).toBe('a');
  });
});

describe('pairIdFor', () => {
  test('order-invariant', () => {
    expect(pairIdFor('a', 'b')).toBe(pairIdFor('b', 'a'));
  });
  test('produces a stable string', () => {
    expect(pairIdFor('z', 'a')).toBe('a|z');
  });
});
