import { describe, it, expect } from 'vitest';
import { DEBT_SUBTYPES } from '../../../firebase/schema.js';
import {
  validateDebtForm,
  validateBucketForm,
  debtFormToPayload,
  bucketFormToPayload,
  emptyDebtForm,
  emptyBucketForm,
  decimalToPercentString,
  percentStringToDecimal,
} from '../formHelpers.js';

describe('percent/decimal conversion', () => {
  it('decimalToPercentString strips FP drift', () => {
    expect(decimalToPercentString(0.199)).toBe('19.9');
    expect(decimalToPercentString(0.025)).toBe('2.5');
    expect(decimalToPercentString(0.2)).toBe('20');
    expect(decimalToPercentString(0)).toBe('0');
  });

  it('decimalToPercentString returns empty for null/undefined', () => {
    expect(decimalToPercentString(null)).toBe('');
    expect(decimalToPercentString(undefined)).toBe('');
  });

  it('percentStringToDecimal inverts cleanly', () => {
    expect(percentStringToDecimal('19.9')).toBe(0.199);
    expect(percentStringToDecimal('2.5')).toBe(0.025);
    expect(percentStringToDecimal('20')).toBe(0.2);
    expect(percentStringToDecimal('0')).toBe(0);
  });
});

describe('validateDebtForm', () => {
  it('requires name', () => {
    const errs = validateDebtForm({ ...emptyDebtForm, subtype: DEBT_SUBTYPES.OVERDRAFT, balance: '100', standard_apr: '0.2' });
    expect(errs.name).toBeDefined();
  });

  it('requires balance for non-card-like subtypes', () => {
    const errs = validateDebtForm({ ...emptyDebtForm, name: 'X', subtype: DEBT_SUBTYPES.PERSONAL_LOAN, standard_apr: '0.1', fixed_payment: '100', term_months: '12' });
    expect(errs.balance).toBeDefined();
  });

  it('does not require balance for card-like subtypes', () => {
    const errs = validateDebtForm({ ...emptyDebtForm, name: 'X', subtype: DEBT_SUBTYPES.CARD, standard_apr: '0.2' });
    expect(errs.balance).toBeUndefined();
  });

  it('rejects APR > 100', () => {
    const errs = validateDebtForm({ ...emptyDebtForm, name: 'X', subtype: DEBT_SUBTYPES.CARD, standard_apr: '150' });
    expect(errs.standard_apr).toMatch(/percent/);
  });

  it('accepts APR as percent (e.g. 19.9 for 19.9%)', () => {
    const errs = validateDebtForm({ ...emptyDebtForm, name: 'X', subtype: DEBT_SUBTYPES.CARD, standard_apr: '19.9' });
    expect(errs.standard_apr).toBeUndefined();
  });

  it('requires fixed_payment and term_months for installment subtypes', () => {
    const errs = validateDebtForm({ ...emptyDebtForm, name: 'X', subtype: DEBT_SUBTYPES.PERSONAL_LOAN, balance: '1000', standard_apr: '0.1' });
    expect(errs.fixed_payment).toBeDefined();
    expect(errs.term_months).toBeDefined();
  });

  it('accepts BNPL without standard_apr', () => {
    const errs = validateDebtForm({ ...emptyDebtForm, name: 'X', subtype: DEBT_SUBTYPES.BNPL, balance: '500', fixed_payment: '100', term_months: '5' });
    expect(errs.standard_apr).toBeUndefined();
  });

  it('rejects out-of-range payment_due_day', () => {
    const errs = validateDebtForm({ ...emptyDebtForm, name: 'X', subtype: DEBT_SUBTYPES.CARD, standard_apr: '0.2', payment_due_day: '40' });
    expect(errs.payment_due_day).toBeDefined();
  });
});

describe('debtFormToPayload', () => {
  it('card-like → balance_pennies: 0 regardless of balance field', () => {
    const payload = debtFormToPayload({
      ...emptyDebtForm,
      name: 'Halifax',
      subtype: DEBT_SUBTYPES.CARD,
      standard_apr: '19.9',
      balance: '999',
    });
    expect(payload.balance_pennies).toBe(0);
    expect(payload.subtype).toBe(DEBT_SUBTYPES.CARD);
    expect(payload.standard_apr).toBe(0.199);
    expect(payload.min_percentage).toBe(0.02);
    expect(payload.min_floor_pennies).toBe(2500);
  });

  it('personal_loan → converts monetary fields to pennies and APR percent to decimal', () => {
    const payload = debtFormToPayload({
      ...emptyDebtForm,
      name: 'Zopa',
      subtype: DEBT_SUBTYPES.PERSONAL_LOAN,
      balance: '4500',
      standard_apr: '8.9',
      fixed_payment: '185',
      term_months: '24',
    });
    expect(payload.balance_pennies).toBe(450000);
    expect(payload.fixed_payment_pennies).toBe(18500);
    expect(payload.term_months).toBe(24);
    expect(payload.standard_apr).toBe(0.089);
  });

  it('overdraft → keeps limit_pennies if provided', () => {
    const payload = debtFormToPayload({
      ...emptyDebtForm,
      name: 'OD',
      subtype: DEBT_SUBTYPES.OVERDRAFT,
      balance: '0',
      standard_apr: '39.9',
      limit: '500',
    });
    expect(payload.limit_pennies).toBe(50000);
    expect(payload.standard_apr).toBe(0.399);
    expect(payload.fixed_payment_pennies).toBeUndefined();
    expect(payload.term_months).toBeUndefined();
  });
});

describe('validateBucketForm', () => {
  it('requires name, balance, apr', () => {
    const errs = validateBucketForm({ ...emptyBucketForm });
    expect(errs.name).toBeDefined();
    expect(errs.balance).toBeDefined();
    expect(errs.apr).toBeDefined();
  });

  it('requires promo_end when is_promo is on', () => {
    const errs = validateBucketForm({ ...emptyBucketForm, name: 'BT', balance: '100', apr: '0', is_promo: true });
    expect(errs.promo_end).toBeDefined();
  });

  it('rejects APR > 100', () => {
    const errs = validateBucketForm({ ...emptyBucketForm, name: 'BT', balance: '100', apr: '150' });
    expect(errs.apr).toMatch(/percent/);
  });
});

describe('bucketFormToPayload', () => {
  it('converts balance to pennies, percent APR to decimal, and attaches debt_id', () => {
    const p = bucketFormToPayload({ ...emptyBucketForm, name: 'Purchases', balance: '123.45', apr: '19.9' }, 'debt-abc');
    expect(p.debt_id).toBe('debt-abc');
    expect(p.balance_pennies).toBe(12345);
    expect(p.apr).toBe(0.199);
    expect(p.is_promo).toBe(false);
    expect(p.promo_end).toBeUndefined();
  });

  it('attaches Firestore Timestamp when promo enabled', () => {
    const p = bucketFormToPayload({ ...emptyBucketForm, name: 'BT', balance: '2800', apr: '0', is_promo: true, promo_end: '2026-09-01' }, 'd1');
    expect(p.is_promo).toBe(true);
    expect(p.promo_end).toBeDefined();
    expect(typeof p.promo_end.toDate).toBe('function');
  });
});
