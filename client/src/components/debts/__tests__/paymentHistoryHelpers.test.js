import { describe, it, expect } from 'vitest';
import {
  buildPaymentTimeline,
  summarisePaymentTimeline,
} from '../paymentHistoryHelpers.js';

function payment(id, debt_id, dateISO, pennies, merchant = 'M') {
  return { id, debt_id, date: dateISO, amount_pennies: pennies, merchant };
}
function snapshot(id, debt_id, asOfISO, pennies, notes) {
  return { id, debt_id, as_of_date: asOfISO, balance_pennies: pennies, notes };
}

describe('buildPaymentTimeline', () => {
  it('returns an empty list when neither source has rows for the debt', () => {
    const out = buildPaymentTimeline({ debtId: 'd1', transactions: [], snapshots: [] });
    expect(out).toEqual([]);
  });

  it('filters to only this debt\'s rows — other debts are excluded', () => {
    const txs = [
      payment('t1', 'd1', '2026-04-05', -10000),
      payment('t2', 'd2', '2026-04-06', -20000), // different debt
    ];
    const snaps = [
      snapshot('s1', 'd1', '2026-03-31', 500000),
      snapshot('s2', 'd2', '2026-03-31', 999999),
    ];
    const out = buildPaymentTimeline({ debtId: 'd1', transactions: txs, snapshots: snaps });
    expect(out.map((r) => r.id)).toEqual(['tx:t1', 'snap:s1']);
  });

  it('merges payments + snapshots into a single timeline sorted newest-first', () => {
    const txs = [
      payment('t1', 'd1', '2026-01-05', -10000),
      payment('t2', 'd1', '2026-03-05', -10000),
      payment('t3', 'd1', '2026-02-05', -10000),
    ];
    const snaps = [
      snapshot('s1', 'd1', '2026-01-31', 500000),
      snapshot('s2', 'd1', '2026-02-28', 490000),
    ];
    const out = buildPaymentTimeline({ debtId: 'd1', transactions: txs, snapshots: snaps });
    // 2026-03-05 → 2026-02-28 → 2026-02-05 → 2026-01-31 → 2026-01-05
    expect(out.map((r) => r.id)).toEqual([
      'tx:t2', 'snap:s2', 'tx:t3', 'snap:s1', 'tx:t1',
    ]);
  });

  it('each row carries kind + original data + timestamp', () => {
    const tx1 = payment('t1', 'd1', '2026-04-05', -8000, 'Barclaycard');
    const s1 = snapshot('s1', 'd1', '2026-03-31', 500000, 'April statement');
    const out = buildPaymentTimeline({
      debtId: 'd1', transactions: [tx1], snapshots: [s1],
    });
    const paymentRow = out.find((r) => r.kind === 'payment');
    const snapshotRow = out.find((r) => r.kind === 'snapshot');
    expect(paymentRow.data).toBe(tx1);
    expect(snapshotRow.data).toBe(s1);
    expect(paymentRow.timestamp).toBeGreaterThan(snapshotRow.timestamp);
  });

  it('drops rows with missing / unparseable dates', () => {
    const out = buildPaymentTimeline({
      debtId: 'd1',
      transactions: [
        payment('t1', 'd1', '2026-03-05', -1000),
        payment('t2', 'd1', null, -1000),
        payment('t3', 'd1', 'not-a-date', -1000),
      ],
      snapshots: [],
    });
    expect(out.map((r) => r.id)).toEqual(['tx:t1']);
  });

  it('handles null / missing input arrays without throwing', () => {
    expect(buildPaymentTimeline({ debtId: 'd1', transactions: null, snapshots: null })).toEqual([]);
    expect(buildPaymentTimeline({ debtId: 'd1' })).toEqual([]);
  });
});

describe('summarisePaymentTimeline', () => {
  it('returns zeros for an empty timeline', () => {
    const s = summarisePaymentTimeline([]);
    expect(s.paymentCount).toBe(0);
    expect(s.paymentPennies).toBe(0);
    expect(s.snapshotCount).toBe(0);
    expect(s.oldestSnapshotBalance).toBeNull();
    expect(s.newestSnapshotBalance).toBeNull();
  });

  it('counts payments and sums absolute pennies', () => {
    const timeline = [
      { kind: 'payment', timestamp: 3, data: { amount_pennies: -15000 } },
      { kind: 'payment', timestamp: 2, data: { amount_pennies: -10000 } },
    ];
    const s = summarisePaymentTimeline(timeline);
    expect(s.paymentCount).toBe(2);
    expect(s.paymentPennies).toBe(25000);
  });

  it('captures newest + oldest snapshot balances (timeline is newest-first)', () => {
    const timeline = [
      { kind: 'snapshot', timestamp: 3, data: { balance_pennies: 470000 } }, // newest
      { kind: 'snapshot', timestamp: 2, data: { balance_pennies: 525000 } },
      { kind: 'snapshot', timestamp: 1, data: { balance_pennies: 600000 } }, // oldest
    ];
    const s = summarisePaymentTimeline(timeline);
    expect(s.snapshotCount).toBe(3);
    expect(s.newestSnapshotBalance).toBe(470000);
    expect(s.oldestSnapshotBalance).toBe(600000);
  });

  it('interleaves payments and snapshots in a mixed timeline', () => {
    const timeline = [
      { kind: 'snapshot', timestamp: 4, data: { balance_pennies: 470000 } },
      { kind: 'payment',  timestamp: 3, data: { amount_pennies: -10000 } },
      { kind: 'snapshot', timestamp: 2, data: { balance_pennies: 500000 } },
      { kind: 'payment',  timestamp: 1, data: { amount_pennies: -10000 } },
    ];
    const s = summarisePaymentTimeline(timeline);
    expect(s.paymentCount).toBe(2);
    expect(s.snapshotCount).toBe(2);
    expect(s.paymentPennies).toBe(20000);
    expect(s.oldestSnapshotBalance).toBe(500000);
    expect(s.newestSnapshotBalance).toBe(470000);
  });
});
