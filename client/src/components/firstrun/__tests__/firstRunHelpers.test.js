import { describe, it, expect } from 'vitest';
import {
  emptyPayCycleForm,
  validatePayCycleForm,
  payCycleFormToPayload,
  emptyAccountForm,
  validateAccountForm,
  accountFormToPayload,
  emptyDebtForm,
  validateFirstRunDebtForm,
  firstRunDebtFormToPayload,
  validateBufferForm,
  bufferFormToPennies,
} from '../firstRunHelpers.js';
import {
  DEFAULT_PAY_CYCLE,
  PAY_CYCLE_CADENCE,
  SHIFT_RULES,
  ACCOUNT_SUBTYPES,
  DEBT_SUBTYPES,
} from '../../../firebase/schema.js';

describe('emptyPayCycleForm', () => {
  it('seeds from DEFAULT_PAY_CYCLE when no initial', () => {
    const f = emptyPayCycleForm();
    expect(f.cadence).toBe(DEFAULT_PAY_CYCLE.cadence);
    expect(f.day_of_month).toBe(String(DEFAULT_PAY_CYCLE.day_of_month));
    expect(f.shift_rule).toBe(DEFAULT_PAY_CYCLE.shift_rule);
    expect(f.honour_bank_holidays).toBe(true);
  });
  it('seeds from an existing profile pay_cycle', () => {
    const f = emptyPayCycleForm({
      cadence: PAY_CYCLE_CADENCE.FOUR_WEEKLY,
      day_of_month: 15,
      shift_rule: SHIFT_RULES.FOLLOWING_WEEKDAY,
      honour_bank_holidays: false,
    });
    expect(f.day_of_month).toBe('15');
    expect(f.shift_rule).toBe(SHIFT_RULES.FOLLOWING_WEEKDAY);
    expect(f.honour_bank_holidays).toBe(false);
  });
});

describe('validatePayCycleForm', () => {
  it('allows 1..31', () => {
    expect(validatePayCycleForm({ day_of_month: '1' })).toEqual({});
    expect(validatePayCycleForm({ day_of_month: '31' })).toEqual({});
    expect(validatePayCycleForm({ day_of_month: '28' })).toEqual({});
  });
  it('rejects out of range', () => {
    expect(validatePayCycleForm({ day_of_month: '0' }).day_of_month).toBeTruthy();
    expect(validatePayCycleForm({ day_of_month: '32' }).day_of_month).toBeTruthy();
    expect(validatePayCycleForm({ day_of_month: '' }).day_of_month).toBeTruthy();
    expect(validatePayCycleForm({ day_of_month: 'abc' }).day_of_month).toBeTruthy();
  });
});

describe('payCycleFormToPayload', () => {
  it('coerces day_of_month to number and preserves the rest', () => {
    const payload = payCycleFormToPayload({
      cadence: PAY_CYCLE_CADENCE.MONTHLY,
      day_of_month: '28',
      shift_rule: SHIFT_RULES.PRECEDING_WEEKDAY,
      honour_bank_holidays: true,
    });
    expect(payload).toEqual({
      cadence: PAY_CYCLE_CADENCE.MONTHLY,
      day_of_month: 28,
      shift_rule: SHIFT_RULES.PRECEDING_WEEKDAY,
      honour_bank_holidays: true,
    });
  });
});

describe('validateAccountForm', () => {
  it('accepts a valid form', () => {
    expect(validateAccountForm({ ...emptyAccountForm, name: 'Current', balance: '1450.00' })).toEqual({});
  });
  it('requires name', () => {
    expect(validateAccountForm({ ...emptyAccountForm, name: '  ', balance: '100' }).name).toBeTruthy();
  });
  it('requires numeric balance', () => {
    expect(validateAccountForm({ ...emptyAccountForm, name: 'X', balance: '' }).balance).toBeTruthy();
    expect(validateAccountForm({ ...emptyAccountForm, name: 'X', balance: 'abc' }).balance).toBeTruthy();
  });
  it('allows negative balance (overdrawn current account)', () => {
    expect(validateAccountForm({ ...emptyAccountForm, name: 'X', balance: '-25.50' })).toEqual({});
  });
});

describe('accountFormToPayload', () => {
  it('trims name, converts balance to pennies, carries subtype', () => {
    expect(accountFormToPayload({
      name: '  Main  ',
      subtype: ACCOUNT_SUBTYPES.SAVINGS,
      balance: '1450.25',
    })).toEqual({
      name: 'Main',
      subtype: ACCOUNT_SUBTYPES.SAVINGS,
      balance_pennies: 145025,
    });
  });
});

describe('validateFirstRunDebtForm', () => {
  it('valid card debt requires name + apr, balance not required', () => {
    expect(validateFirstRunDebtForm({
      ...emptyDebtForm, name: 'Barclaycard', subtype: DEBT_SUBTYPES.CARD, standard_apr: '19.9',
    })).toEqual({});
  });
  it('card debt without APR is rejected', () => {
    const e = validateFirstRunDebtForm({
      ...emptyDebtForm, name: 'X', subtype: DEBT_SUBTYPES.CARD,
    });
    expect(e.standard_apr).toBeTruthy();
  });
  it('overdraft requires balance + APR', () => {
    const e = validateFirstRunDebtForm({
      ...emptyDebtForm, name: 'OD', subtype: DEBT_SUBTYPES.OVERDRAFT,
    });
    expect(e.balance).toBeTruthy();
    expect(e.standard_apr).toBeTruthy();
  });
  it('installment requires fixed_payment and term_months but NOT APR', () => {
    const e = validateFirstRunDebtForm({
      ...emptyDebtForm, name: 'Zopa', subtype: DEBT_SUBTYPES.BNPL, balance: '500',
    });
    expect(e.fixed_payment).toBeTruthy();
    expect(e.term_months).toBeTruthy();
    expect(e.standard_apr).toBeUndefined();
  });
  it('APR above 100 is rejected as a percent input error', () => {
    const e = validateFirstRunDebtForm({
      ...emptyDebtForm, name: 'X', subtype: DEBT_SUBTYPES.CARD, standard_apr: '199',
    });
    expect(e.standard_apr).toBeTruthy();
  });
});

describe('firstRunDebtFormToPayload', () => {
  it('card debt: balance_pennies = 0, APR decimalised', () => {
    const payload = firstRunDebtFormToPayload({
      ...emptyDebtForm, name: 'Barclaycard', subtype: DEBT_SUBTYPES.CARD, standard_apr: '19.9',
    });
    expect(payload.balance_pennies).toBe(0);
    expect(payload.standard_apr).toBeCloseTo(0.199, 5);
    expect(payload.name).toBe('Barclaycard');
  });
  it('overdraft: balance_pennies from pounds', () => {
    const payload = firstRunDebtFormToPayload({
      ...emptyDebtForm, name: 'OD', subtype: DEBT_SUBTYPES.OVERDRAFT,
      balance: '250.50', standard_apr: '39.9',
    });
    expect(payload.balance_pennies).toBe(25050);
    expect(payload.standard_apr).toBeCloseTo(0.399, 5);
  });
  it('installment: fixed_payment + term carried, balance used as principal', () => {
    const payload = firstRunDebtFormToPayload({
      ...emptyDebtForm, name: 'Zopa', subtype: DEBT_SUBTYPES.PERSONAL_LOAN,
      balance: '5000', standard_apr: '9.9', fixed_payment: '212.50', term_months: '24',
    });
    expect(payload.balance_pennies).toBe(500000);
    expect(payload.fixed_payment_pennies).toBe(21250);
    expect(payload.term_months).toBe(24);
  });
});

describe('validateBufferForm + bufferFormToPennies', () => {
  it('blank buffer is valid (skippable -> £0)', () => {
    expect(validateBufferForm({ buffer: '' })).toEqual({});
    expect(bufferFormToPennies({ buffer: '' })).toBe(0);
  });
  it('rejects non-numeric / negative', () => {
    expect(validateBufferForm({ buffer: 'abc' }).buffer).toBeTruthy();
    expect(validateBufferForm({ buffer: '-5' }).buffer).toBeTruthy();
  });
  it('converts to pennies', () => {
    expect(bufferFormToPennies({ buffer: '200' })).toBe(20000);
    expect(bufferFormToPennies({ buffer: '250.75' })).toBe(25075);
  });
});
