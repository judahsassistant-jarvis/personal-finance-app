import { describe, it, expect } from 'vitest';
import {
  emptyAccountFormState,
  accountToForm,
  applySubtypeChange,
  validateAccountForm,
  accountFormToPayload,
  accountFormToEditPatch,
  RATE_BEARING_SUBTYPES,
  CONTRIBUTION_SUBTYPES,
} from '../accountFormHelpers.js';
import { ACCOUNT_SUBTYPES, LIQUIDITY } from '../../../firebase/schema.js';

describe('emptyAccountFormState', () => {
  it('defaults to a current account', () => {
    const f = emptyAccountFormState();
    expect(f.subtype).toBe(ACCOUNT_SUBTYPES.CURRENT);
    expect(f.rate).toBe('0'); // current rate default = 0
    expect(f.include_in_safe_to_spend).toBe(true);
  });
  it('seeds rate + safe-to-spend from subtype defaults when given', () => {
    const f = emptyAccountFormState(ACCOUNT_SUBTYPES.SAVINGS);
    expect(f.rate).toBe('4'); // 0.04 * 100
    expect(f.include_in_safe_to_spend).toBe(false);
  });
});

describe('accountToForm', () => {
  it('round-trips an existing account doc into form state', () => {
    const acc = {
      name: 'Main',
      subtype: ACCOUNT_SUBTYPES.SAVINGS,
      balance_pennies: 150000,
      interest_rate: 0.045,
      monthly_contribution_pennies: 10000,
      include_in_safe_to_spend: true,
    };
    const f = accountToForm(acc);
    expect(f).toMatchObject({
      name: 'Main',
      subtype: ACCOUNT_SUBTYPES.SAVINGS,
      balance: '1500',
      rate: '4.5',
      monthly_contribution: '100',
      include_in_safe_to_spend: true,
    });
  });
  it('prefers growth_rate over interest_rate when both are unset (neither)', () => {
    const f = accountToForm({ subtype: ACCOUNT_SUBTYPES.SIPP });
    expect(f.rate).toBe('');
  });
  it('surfaces sipp_age', () => {
    const f = accountToForm({ subtype: ACCOUNT_SUBTYPES.SIPP, sipp_age: 58 });
    expect(f.sipp_age).toBe('58');
  });
  it('surfaces pension_age', () => {
    const f = accountToForm({ subtype: ACCOUNT_SUBTYPES.PENSION, pension_age: 65 });
    expect(f.pension_age).toBe('65');
  });
});

describe('applySubtypeChange', () => {
  it('swaps defaults but preserves name + balance + contribution', () => {
    const start = {
      name: 'Main', subtype: ACCOUNT_SUBTYPES.CURRENT, balance: '1000',
      rate: '0', sipp_age: '', monthly_contribution: '50',
      include_in_safe_to_spend: true,
    };
    const next = applySubtypeChange(start, ACCOUNT_SUBTYPES.SIPP);
    expect(next.subtype).toBe(ACCOUNT_SUBTYPES.SIPP);
    expect(next.rate).toBe('5'); // SIPP default = 0.05
    expect(next.include_in_safe_to_spend).toBe(false); // SIPP default
    expect(next.name).toBe('Main');
    expect(next.balance).toBe('1000');
    expect(next.monthly_contribution).toBe('50');
  });
  it('clears sipp_age when leaving SIPP', () => {
    const start = { name: '', subtype: ACCOUNT_SUBTYPES.SIPP, balance: '', rate: '5', sipp_age: '58', pension_age: '', monthly_contribution: '', include_in_safe_to_spend: false };
    const next = applySubtypeChange(start, ACCOUNT_SUBTYPES.SAVINGS);
    expect(next.sipp_age).toBe('');
  });
  it('clears pension_age when leaving PENSION', () => {
    const start = { name: '', subtype: ACCOUNT_SUBTYPES.PENSION, balance: '', rate: '5', sipp_age: '', pension_age: '65', monthly_contribution: '', include_in_safe_to_spend: false };
    const next = applySubtypeChange(start, ACCOUNT_SUBTYPES.SAVINGS);
    expect(next.pension_age).toBe('');
  });
});

describe('validateAccountForm', () => {
  function base(overrides = {}) {
    return {
      name: 'X', subtype: ACCOUNT_SUBTYPES.SAVINGS, balance: '1000',
      rate: '4', sipp_age: '', pension_age: '', monthly_contribution: '',
      include_in_safe_to_spend: false, ...overrides,
    };
  }
  it('accepts a valid form', () => {
    expect(validateAccountForm(base())).toEqual({});
  });
  it('requires name', () => {
    expect(validateAccountForm(base({ name: '' })).name).toBeTruthy();
  });
  it('requires numeric balance', () => {
    expect(validateAccountForm(base({ balance: '' })).balance).toBeTruthy();
    expect(validateAccountForm(base({ balance: 'abc' })).balance).toBeTruthy();
  });
  it('allows negative balance (overdrawn current account)', () => {
    expect(validateAccountForm(base({ subtype: ACCOUNT_SUBTYPES.CURRENT, balance: '-25.50' }))).toEqual({});
  });
  it('rejects non-numeric / negative rate, and >100 (percent input error)', () => {
    expect(validateAccountForm(base({ rate: 'abc' })).rate).toBeTruthy();
    expect(validateAccountForm(base({ rate: '-1' })).rate).toBeTruthy();
    expect(validateAccountForm(base({ rate: '250' })).rate).toBeTruthy();
  });
  it('allows blank rate', () => {
    expect(validateAccountForm(base({ rate: '' }))).toEqual({});
  });
  it('SIPP requires sipp_age in 50..75', () => {
    expect(validateAccountForm(base({ subtype: ACCOUNT_SUBTYPES.SIPP })).sipp_age).toBeTruthy();
    expect(validateAccountForm(base({ subtype: ACCOUNT_SUBTYPES.SIPP, sipp_age: '40' })).sipp_age).toBeTruthy();
    expect(validateAccountForm(base({ subtype: ACCOUNT_SUBTYPES.SIPP, sipp_age: '90' })).sipp_age).toBeTruthy();
    expect(validateAccountForm(base({ subtype: ACCOUNT_SUBTYPES.SIPP, sipp_age: '58' }))).toEqual({});
  });
  it('PENSION requires pension_age in 50..75', () => {
    expect(validateAccountForm(base({ subtype: ACCOUNT_SUBTYPES.PENSION })).pension_age).toBeTruthy();
    expect(validateAccountForm(base({ subtype: ACCOUNT_SUBTYPES.PENSION, pension_age: '40' })).pension_age).toBeTruthy();
    expect(validateAccountForm(base({ subtype: ACCOUNT_SUBTYPES.PENSION, pension_age: '90' })).pension_age).toBeTruthy();
    expect(validateAccountForm(base({ subtype: ACCOUNT_SUBTYPES.PENSION, pension_age: '65' }))).toEqual({});
  });
  it('rejects negative monthly_contribution for locked subtypes', () => {
    expect(validateAccountForm(base({ subtype: ACCOUNT_SUBTYPES.SS_ISA, monthly_contribution: '-100' })).monthly_contribution).toBeTruthy();
  });
});

describe('accountFormToPayload', () => {
  it('builds a savings payload with interest_rate decimal', () => {
    const payload = accountFormToPayload({
      name: ' Main ', subtype: ACCOUNT_SUBTYPES.SAVINGS, balance: '1500.25',
      rate: '4.5', sipp_age: '', pension_age: '', monthly_contribution: '100',
      include_in_safe_to_spend: false,
    });
    expect(payload.name).toBe('Main');
    expect(payload.balance_pennies).toBe(150025);
    expect(payload.liquidity).toBe(LIQUIDITY.LIQUID);
    expect(payload.interest_rate).toBeCloseTo(0.045, 5);
    expect(payload.monthly_contribution_pennies).toBe(10000);
    expect(payload).not.toHaveProperty('growth_rate');
  });
  it('builds a SIPP payload with growth_rate + sipp_age', () => {
    const payload = accountFormToPayload({
      name: 'SIPP', subtype: ACCOUNT_SUBTYPES.SIPP, balance: '50000',
      rate: '5', sipp_age: '58', pension_age: '', monthly_contribution: '300',
      include_in_safe_to_spend: false,
    });
    expect(payload.liquidity).toBe(LIQUIDITY.LOCKED);
    expect(payload.growth_rate).toBeCloseTo(0.05, 5);
    expect(payload.sipp_age).toBe(58);
    expect(payload.monthly_contribution_pennies).toBe(30000);
    expect(payload).not.toHaveProperty('interest_rate');
    expect(payload).not.toHaveProperty('pension_age');
  });
  it('builds a PENSION payload with growth_rate + pension_age', () => {
    const payload = accountFormToPayload({
      name: 'Workplace', subtype: ACCOUNT_SUBTYPES.PENSION, balance: '80000',
      rate: '5', sipp_age: '', pension_age: '65', monthly_contribution: '500',
      include_in_safe_to_spend: false,
    });
    expect(payload.liquidity).toBe(LIQUIDITY.LOCKED);
    expect(payload.growth_rate).toBeCloseTo(0.05, 5);
    expect(payload.pension_age).toBe(65);
    expect(payload).not.toHaveProperty('sipp_age');
  });
  it('omits rate + contribution when blank for rate-bearing subtype', () => {
    const payload = accountFormToPayload({
      name: 'X', subtype: ACCOUNT_SUBTYPES.SAVINGS, balance: '100',
      rate: '', sipp_age: '', pension_age: '', monthly_contribution: '',
      include_in_safe_to_spend: false,
    });
    expect(payload).not.toHaveProperty('interest_rate');
    expect(payload).not.toHaveProperty('monthly_contribution_pennies');
  });
  it('current accounts produce no rate fields', () => {
    const payload = accountFormToPayload({
      name: 'C', subtype: ACCOUNT_SUBTYPES.CURRENT, balance: '100',
      rate: '99', sipp_age: '', pension_age: '', monthly_contribution: '',
      include_in_safe_to_spend: true,
    });
    expect(payload).not.toHaveProperty('interest_rate');
    expect(payload).not.toHaveProperty('growth_rate');
  });
});

describe('accountFormToEditPatch', () => {
  it('nulls previously-set fields when blanked in the form', () => {
    const existing = {
      subtype: ACCOUNT_SUBTYPES.SAVINGS,
      interest_rate: 0.04,
      monthly_contribution_pennies: 5000,
    };
    const form = {
      name: 'X', subtype: ACCOUNT_SUBTYPES.SAVINGS, balance: '0',
      rate: '', sipp_age: '', pension_age: '', monthly_contribution: '',
      include_in_safe_to_spend: false,
    };
    const patch = accountFormToEditPatch(form, existing);
    expect(patch.interest_rate).toBeNull();
    expect(patch.monthly_contribution_pennies).toBeNull();
  });
  it('nulls sipp_age + growth_rate when subtype changes off SIPP', () => {
    const existing = {
      subtype: ACCOUNT_SUBTYPES.SIPP,
      growth_rate: 0.05, sipp_age: 58,
    };
    const form = {
      name: 'X', subtype: ACCOUNT_SUBTYPES.SAVINGS, balance: '100',
      rate: '4', sipp_age: '', pension_age: '', monthly_contribution: '',
      include_in_safe_to_spend: false,
    };
    const patch = accountFormToEditPatch(form, existing);
    expect(patch.interest_rate).toBeCloseTo(0.04, 5);
    expect(patch.growth_rate).toBeNull();
    expect(patch.sipp_age).toBeNull();
  });
  it('nulls pension_age when subtype changes off PENSION', () => {
    const existing = {
      subtype: ACCOUNT_SUBTYPES.PENSION,
      growth_rate: 0.05, pension_age: 65,
    };
    const form = {
      name: 'X', subtype: ACCOUNT_SUBTYPES.SAVINGS, balance: '100',
      rate: '4', sipp_age: '', pension_age: '', monthly_contribution: '',
      include_in_safe_to_spend: false,
    };
    const patch = accountFormToEditPatch(form, existing);
    expect(patch.pension_age).toBeNull();
    expect(patch.growth_rate).toBeNull();
  });
});

describe('SUBTYPE sets', () => {
  it('rate-bearing excludes current', () => {
    expect(RATE_BEARING_SUBTYPES.has(ACCOUNT_SUBTYPES.CURRENT)).toBe(false);
    expect(RATE_BEARING_SUBTYPES.has(ACCOUNT_SUBTYPES.SAVINGS)).toBe(true);
    expect(RATE_BEARING_SUBTYPES.has(ACCOUNT_SUBTYPES.SIPP)).toBe(true);
  });
  it('contribution excludes current', () => {
    expect(CONTRIBUTION_SUBTYPES.has(ACCOUNT_SUBTYPES.CURRENT)).toBe(false);
    expect(CONTRIBUTION_SUBTYPES.has(ACCOUNT_SUBTYPES.SIPP)).toBe(true);
  });
});
