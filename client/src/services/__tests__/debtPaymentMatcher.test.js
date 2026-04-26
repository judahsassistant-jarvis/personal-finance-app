import { describe, it, expect } from 'vitest';
import { suggestDebtForTransaction, suggestTagsForUntagged } from '../debtPaymentMatcher.js';

const debts = [
  { id: 'barclay', name: 'Barclaycard Platinum' },
  { id: 'halifax', name: 'Halifax Clarity' },
  { id: 'zopa', name: 'Zopa Personal Loan' },
  { id: 'klarna', name: 'Klarna Sofa Purchase' },
];

describe('suggestDebtForTransaction', () => {
  it('matches "BARCLAYCARD" to the Barclaycard debt', () => {
    const out = suggestDebtForTransaction(
      { merchant: 'BARCLAYCARD', amount_pennies: -10000 }, debts
    );
    expect(out.debtId).toBe('barclay');
  });

  it('matches partial merchant strings (e.g. "BARCLAYCARD BP" with extra tokens)', () => {
    const out = suggestDebtForTransaction(
      { merchant: 'BARCLAYCARD BP REF123', amount_pennies: -15000 }, debts
    );
    expect(out.debtId).toBe('barclay');
  });

  it('matches "ZOPA LTD" to Zopa', () => {
    expect(suggestDebtForTransaction(
      { merchant: 'ZOPA LTD DD', amount_pennies: -18500 }, debts
    ).debtId).toBe('zopa');
  });

  it('matches "KLARNA*SOFA" with punctuation stripped', () => {
    expect(suggestDebtForTransaction(
      { merchant: 'KLARNA*SOFA', amount_pennies: -9000 }, debts
    ).debtId).toBe('klarna');
  });

  it('matches "HALIFAX CREDIT CARD" to the Halifax debt', () => {
    expect(suggestDebtForTransaction(
      { merchant: 'HALIFAX CREDIT CARD', amount_pennies: -5000 }, debts
    ).debtId).toBe('halifax');
  });

  it('returns null for an inflow transaction (never a debt payment)', () => {
    expect(suggestDebtForTransaction(
      { merchant: 'BARCLAYCARD REFUND', amount_pennies: 5000 }, debts
    )).toBeNull();
  });

  it('returns null when the merchant has no overlap with any debt', () => {
    expect(suggestDebtForTransaction(
      { merchant: 'TESCO SUPERSTORE', amount_pennies: -6000 }, debts
    )).toBeNull();
  });

  it('returns null for a missing or empty merchant', () => {
    expect(suggestDebtForTransaction(
      { merchant: '', amount_pennies: -1000 }, debts
    )).toBeNull();
    expect(suggestDebtForTransaction(
      { amount_pennies: -1000 }, debts
    )).toBeNull();
  });

  it('ignores words shorter than 4 characters (noise filter)', () => {
    // "CC" is 2 chars; no meaningful overlap
    expect(suggestDebtForTransaction(
      { merchant: 'CC DD', amount_pennies: -1000 }, debts
    )).toBeNull();
  });

  it('picks the highest-scoring match when multiple debts overlap', () => {
    // "KLARNA SOFA" overlaps with Klarna (klarna + sofa + purchase would score
    // highest against the full debt name); no other debt has these words.
    expect(suggestDebtForTransaction(
      { merchant: 'KLARNA SOFA', amount_pennies: -9000 }, debts
    ).debtId).toBe('klarna');
  });

  it('handles empty / null inputs gracefully', () => {
    expect(suggestDebtForTransaction(null, debts)).toBeNull();
    expect(suggestDebtForTransaction({ merchant: 'X', amount_pennies: -100 }, [])).toBeNull();
    expect(suggestDebtForTransaction({ merchant: 'X', amount_pennies: -100 }, null)).toBeNull();
  });

  describe('specificity guard (PayPal-prefix false-positive fix)', () => {
    const debtsWithPaypal = [
      ...debts,
      { id: 'paypal-credit', name: 'PayPal Credit' },
    ];

    it('rejects "PayPal: Steam" as a PayPal Credit suggestion', () => {
      // The new csvParser format prefixes PayPal-mediated rows. Without the
      // specificity guard, "paypal" alone (6 chars) was scoring 6 against the
      // PayPal Credit debt and triggering a spurious tag suggestion on every
      // Steam / Dropbox / Microsoft / Shopify purchase that PayPal funded.
      expect(suggestDebtForTransaction(
        { merchant: 'PayPal: Steam', amount_pennies: -1623 }, debtsWithPaypal
      )).toBeNull();
    });

    it('rejects "PayPal: Dropbox" / "PayPal: YouTube" / "PayPal: Microsoft"', () => {
      for (const m of ['PayPal: Dropbox', 'PayPal: YouTube', 'PayPal: Microsoft', 'PayPal: Shopify']) {
        expect(suggestDebtForTransaction(
          { merchant: m, amount_pennies: -999 }, debtsWithPaypal
        )).toBeNull();
      }
    });

    it('still accepts the actual "PayPal Credit" repayment row', () => {
      expect(suggestDebtForTransaction(
        { merchant: 'PayPal Credit', amount_pennies: -8254 }, debtsWithPaypal
      ).debtId).toBe('paypal-credit');
    });

    it('treats reference-number tokens (digits) as non-disqualifying', () => {
      // "REF123" must not block the BARCLAYCARD match — it's a transaction
      // reference, not an alternative merchant name.
      expect(suggestDebtForTransaction(
        { merchant: 'BARCLAYCARD BP REF123', amount_pennies: -15000 }, debtsWithPaypal
      ).debtId).toBe('barclay');
    });

    it('treats common bank labels (card, payment, credit) as non-disqualifying', () => {
      // "HALIFAX CREDIT CARD" should still match the Halifax Clarity debt —
      // 'credit' and 'card' are generic transaction labels, not alternative
      // merchant names. The earlier test of this case still passes; this test
      // re-asserts it specifically against the new specificity guard.
      expect(suggestDebtForTransaction(
        { merchant: 'HALIFAX CREDIT CARD', amount_pennies: -5000 }, debtsWithPaypal
      ).debtId).toBe('halifax');
    });
  });
});

describe('suggestTagsForUntagged', () => {
  it('returns a map of tx-id → suggested debt-id for untagged outflows', () => {
    const txs = [
      { id: 't1', merchant: 'BARCLAYCARD', amount_pennies: -10000 },
      { id: 't2', merchant: 'TESCO', amount_pennies: -5000 },  // no match
      { id: 't3', merchant: 'ZOPA LTD', amount_pennies: -18500 },
    ];
    const out = suggestTagsForUntagged(txs, debts);
    expect(out.get('t1')).toBe('barclay');
    expect(out.has('t2')).toBe(false);
    expect(out.get('t3')).toBe('zopa');
  });

  it('skips transactions that already have a debt_id set', () => {
    const txs = [
      { id: 't1', merchant: 'BARCLAYCARD', amount_pennies: -10000, debt_id: 'some-other' },
    ];
    const out = suggestTagsForUntagged(txs, debts);
    expect(out.has('t1')).toBe(false);
  });

  it('returns an empty map for an empty list', () => {
    expect(suggestTagsForUntagged([], debts).size).toBe(0);
    expect(suggestTagsForUntagged(null, debts).size).toBe(0);
  });
});
