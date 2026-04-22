import { describe, it, expect } from 'vitest';
import { DEBT_SUBTYPES } from '../../../firebase/schema.js';
import {
  WHAT_IF_MODES,
  computeWhatIfImpact,
  whatIfInputsValid,
  poundsInputToPennies,
  percentInputToDecimal,
  intInput,
} from '../whatIfHelpers.js';

const baseSetup = () => ({
  debts: [{
    id: 'card', subtype: DEBT_SUBTYPES.CARD, user_id: 'u', name: 'Card',
    standard_apr: 0.249, min_percentage: 0.025, min_floor_pennies: 2500,
  }],
  buckets: [{ id: 'b1', debt_id: 'card', name: 'Std', balance_pennies: 500000, apr: 0.249, is_promo: false }],
  startMonth: '2026-05-01',
  months: 60,
  monthlyBudget: 30000,
  strategy: 'avalanche',
});

const newCard = (overrides = {}) => ({
  name: 'BT',
  standardApr: 0.099,
  promoApr: 0,
  promoMonths: 18,
  feePercent: 0.03,
  ...overrides,
});

describe('computeWhatIfImpact (single mode)', () => {
  it('returns baseline + with-bt summaries with non-negative deltas', () => {
    const out = computeWhatIfImpact({
      ...baseSetup(),
      mode: WHAT_IF_MODES.SINGLE,
      params: {
        sourceDebtId: 'card',
        transferPennies: 500000,
        newCard: newCard(),
        now: new Date(2026, 4, 1),
      },
    });
    expect(out.baseline.totalInterestPennies).toBeGreaterThan(0);
    expect(out.interestSavedPennies).toBeGreaterThanOrEqual(0);
    expect(out.monthsSaved).toBeGreaterThanOrEqual(0);
  });

  it('a clear-win BT (high APR → 0% with low fee) shows positive net savings', () => {
    const out = computeWhatIfImpact({
      ...baseSetup(),
      mode: WHAT_IF_MODES.SINGLE,
      params: {
        sourceDebtId: 'card',
        transferPennies: 500000,
        newCard: newCard({ feePercent: 0.025 }),
        now: new Date(2026, 4, 1),
      },
    });
    expect(out.netSavingsPennies).toBeGreaterThan(0);
    expect(out.feePennies).toBe(12500); // 500000 * 0.025
  });

  it('a value-destroying BT (no promo, same rate, high fee) shows a net loss', () => {
    // No promo, post-promo APR matches the source APR, plus a 10% fee on top.
    // There's no rate benefit anywhere — it's pure cost.
    const out = computeWhatIfImpact({
      ...baseSetup(),
      mode: WHAT_IF_MODES.SINGLE,
      params: {
        sourceDebtId: 'card',
        transferPennies: 500000,
        newCard: newCard({ promoMonths: 0, standardApr: 0.249, feePercent: 0.10 }),
        now: new Date(2026, 4, 1),
      },
    });
    expect(out.feePennies).toBe(50000);
    expect(out.netSavingsPennies).toBeLessThanOrEqual(0);
  });
});

describe('computeWhatIfImpact (multi mode)', () => {
  it('returns allocations alongside the comparison', () => {
    const setup = {
      debts: [
        { id: 'a', subtype: DEBT_SUBTYPES.CARD, user_id: 'u', standard_apr: 0.249, min_percentage: 0.025, min_floor_pennies: 2500 },
        { id: 'b', subtype: DEBT_SUBTYPES.CARD, user_id: 'u', standard_apr: 0.199, min_percentage: 0.025, min_floor_pennies: 2500 },
      ],
      buckets: [
        { id: 'a-b', debt_id: 'a', balance_pennies: 200000, apr: 0.249, is_promo: false },
        { id: 'b-b', debt_id: 'b', balance_pennies: 300000, apr: 0.199, is_promo: false },
      ],
      startMonth: '2026-05-01',
      months: 60,
      monthlyBudget: 30000,
      strategy: 'avalanche',
    };
    const out = computeWhatIfImpact({
      ...setup,
      mode: WHAT_IF_MODES.MULTI,
      params: {
        availableLimitPennies: 250000,
        eligibleDebtIds: ['a', 'b'],
        newCard: newCard(),
        now: new Date(2026, 4, 1),
      },
    });
    expect(out.allocations).toHaveLength(2);
    expect(out.allocations[0].debt_id).toBe('a'); // higher APR first
    expect(out.transferPennies).toBe(250000);
  });
});

describe('whatIfInputsValid', () => {
  const validSingle = {
    sourceDebtId: 'card',
    transferPennies: 100000,
    standardApr: 0.219,
    promoApr: 0,
    promoMonths: 12,
    feePercent: 0.03,
  };

  it('single mode: passes when every field is set', () => {
    expect(whatIfInputsValid(WHAT_IF_MODES.SINGLE, validSingle)).toBe(true);
  });

  it('single mode: fails when source is missing', () => {
    expect(whatIfInputsValid(WHAT_IF_MODES.SINGLE, { ...validSingle, sourceDebtId: '' })).toBe(false);
  });

  it('single mode: fails when transfer amount is zero', () => {
    expect(whatIfInputsValid(WHAT_IF_MODES.SINGLE, { ...validSingle, transferPennies: 0 })).toBe(false);
  });

  it('single mode: fails when any APR is missing or negative', () => {
    expect(whatIfInputsValid(WHAT_IF_MODES.SINGLE, { ...validSingle, standardApr: null })).toBe(false);
    expect(whatIfInputsValid(WHAT_IF_MODES.SINGLE, { ...validSingle, promoApr: -1 })).toBe(false);
  });

  it('single mode: passes with promoMonths = 0 (no-promo BT card)', () => {
    expect(whatIfInputsValid(WHAT_IF_MODES.SINGLE, { ...validSingle, promoMonths: 0 })).toBe(true);
  });

  const validMulti = {
    availableLimitPennies: 1_000_000,
    eligibleDebtIds: ['a', 'b'],
    standardApr: 0.219,
    promoApr: 0,
    promoMonths: 12,
    feePercent: 0.03,
  };

  it('multi mode: passes when limit and eligible list are set', () => {
    expect(whatIfInputsValid(WHAT_IF_MODES.MULTI, validMulti)).toBe(true);
  });

  it('multi mode: fails when limit is zero', () => {
    expect(whatIfInputsValid(WHAT_IF_MODES.MULTI, { ...validMulti, availableLimitPennies: 0 })).toBe(false);
  });

  it('multi mode: fails when no debts are eligible', () => {
    expect(whatIfInputsValid(WHAT_IF_MODES.MULTI, { ...validMulti, eligibleDebtIds: [] })).toBe(false);
  });
});

describe('poundsInputToPennies', () => {
  it('converts decimal pounds to integer pennies', () => {
    expect(poundsInputToPennies('100')).toBe(10000);
    expect(poundsInputToPennies('100.50')).toBe(10050);
    expect(poundsInputToPennies('0')).toBe(0);
  });

  it('returns null for empty / invalid / negative', () => {
    expect(poundsInputToPennies('')).toBe(null);
    expect(poundsInputToPennies(null)).toBe(null);
    expect(poundsInputToPennies('abc')).toBe(null);
    expect(poundsInputToPennies('-5')).toBe(null);
  });
});

describe('percentInputToDecimal', () => {
  it('divides by 100', () => {
    expect(percentInputToDecimal('21.9')).toBeCloseTo(0.219, 5);
    expect(percentInputToDecimal('0')).toBe(0);
    expect(percentInputToDecimal('100')).toBe(1);
  });

  it('returns null for invalid', () => {
    expect(percentInputToDecimal('')).toBe(null);
    expect(percentInputToDecimal('abc')).toBe(null);
    expect(percentInputToDecimal('-1')).toBe(null);
  });
});

describe('intInput', () => {
  it('parses integer strings', () => {
    expect(intInput('12')).toBe(12);
    expect(intInput('0')).toBe(0);
  });

  it('returns null for non-integer / negative / empty', () => {
    expect(intInput('')).toBe(null);
    expect(intInput('1.5')).toBe(null);
    expect(intInput('-3')).toBe(null);
    expect(intInput(null)).toBe(null);
  });
});
