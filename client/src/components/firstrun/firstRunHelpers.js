/**
 * Pure helpers for the first-run wizard (Sprint 5). Kept separate from the
 * component so Fast Refresh stays clean and Vitest can import without a DOM.
 */
import {
  DEFAULT_PAY_CYCLE,
  PAY_CYCLE_CADENCE,
  SHIFT_RULES,
  ACCOUNT_SUBTYPES,
  DEBT_SUBTYPES,
  CARD_LIKE_SUBTYPES,
  INSTALLMENT_SUBTYPES,
  poundsToPennies,
} from '../../firebase/schema.js';

// ---------------------------------------------------------------------------
// Pay cycle step
// ---------------------------------------------------------------------------

export function emptyPayCycleForm(initial) {
  const base = initial ?? DEFAULT_PAY_CYCLE;
  return {
    cadence: base.cadence ?? PAY_CYCLE_CADENCE.MONTHLY,
    day_of_month: String(base.day_of_month ?? 28),
    shift_rule: base.shift_rule ?? SHIFT_RULES.PRECEDING_WEEKDAY,
    honour_bank_holidays: base.honour_bank_holidays ?? true,
  };
}

export function validatePayCycleForm(form) {
  const errors = {};
  const d = Number(form.day_of_month);
  if (!Number.isInteger(d) || d < 1 || d > 31) {
    errors.day_of_month = 'Must be 1–31';
  }
  return errors;
}

export function payCycleFormToPayload(form) {
  return {
    cadence: form.cadence,
    day_of_month: Number(form.day_of_month),
    shift_rule: form.shift_rule,
    honour_bank_holidays: !!form.honour_bank_holidays,
  };
}

// ---------------------------------------------------------------------------
// Account step (minimal form — full edits happen on the Accounts page later)
// ---------------------------------------------------------------------------

export const emptyAccountForm = {
  name: '',
  subtype: ACCOUNT_SUBTYPES.CURRENT,
  balance: '',
};

export function validateAccountForm(form) {
  const errors = {};
  if (!form.name || form.name.trim().length < 1) errors.name = 'Name is required';
  if (form.balance === '' || form.balance == null) {
    errors.balance = 'Balance is required';
  } else {
    const n = Number(form.balance);
    if (!Number.isFinite(n)) errors.balance = 'Must be a number';
  }
  return errors;
}

export function accountFormToPayload(form) {
  return {
    name: form.name.trim(),
    subtype: form.subtype,
    balance_pennies: poundsToPennies(form.balance),
  };
}

// ---------------------------------------------------------------------------
// Debt step (minimal fields — details filled in on Debt Planner later)
// ---------------------------------------------------------------------------

export const emptyDebtForm = {
  name: '',
  subtype: DEBT_SUBTYPES.CARD,
  balance: '',
  standard_apr: '',
  fixed_payment: '',
  term_months: '',
};

export function validateFirstRunDebtForm(form) {
  const errors = {};
  if (!form.name || form.name.trim().length < 1) errors.name = 'Name is required';

  const isCard = CARD_LIKE_SUBTYPES.has(form.subtype);
  const isInstallment = INSTALLMENT_SUBTYPES.has(form.subtype);

  if (!isCard) {
    if (form.balance === '' || form.balance == null) {
      errors.balance = 'Balance is required';
    } else {
      const b = Number(form.balance);
      if (!Number.isFinite(b) || b < 0) errors.balance = 'Must be 0 or greater';
    }
  }

  if (form.standard_apr !== '' && form.standard_apr != null) {
    const apr = Number(form.standard_apr);
    if (!Number.isFinite(apr) || apr < 0) errors.standard_apr = 'APR must be 0 or greater';
    else if (apr > 100) errors.standard_apr = 'Enter as percent (e.g. 19.9)';
  } else if (form.subtype !== DEBT_SUBTYPES.BNPL) {
    errors.standard_apr = 'APR is required';
  }

  if (isInstallment) {
    if (form.fixed_payment === '') {
      errors.fixed_payment = 'Required';
    } else {
      const fp = Number(form.fixed_payment);
      if (!Number.isFinite(fp) || fp < 0) errors.fixed_payment = 'Must be 0 or greater';
    }
    if (form.term_months === '') {
      errors.term_months = 'Required';
    } else {
      const tm = Number(form.term_months);
      if (!Number.isInteger(tm) || tm < 1) errors.term_months = 'Must be 1 or more';
    }
  }

  return errors;
}

export function firstRunDebtFormToPayload(form) {
  const isCard = CARD_LIKE_SUBTYPES.has(form.subtype);
  const isInstallment = INSTALLMENT_SUBTYPES.has(form.subtype);
  const payload = {
    name: form.name.trim(),
    subtype: form.subtype,
  };
  if (isCard) {
    payload.balance_pennies = 0; // card balance is derived from buckets, added later
  } else {
    payload.balance_pennies = poundsToPennies(form.balance);
  }
  if (form.standard_apr !== '') {
    payload.standard_apr = Math.round(Number(form.standard_apr) * 1000) / 100000;
  }
  if (isInstallment) {
    payload.fixed_payment_pennies = poundsToPennies(form.fixed_payment);
    payload.term_months = Number(form.term_months);
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Buffer step
// ---------------------------------------------------------------------------

export function validateBufferForm(form) {
  const errors = {};
  if (form.buffer === '' || form.buffer == null) return errors; // skippable blank => 0
  const n = Number(form.buffer);
  if (!Number.isFinite(n) || n < 0) errors.buffer = 'Must be 0 or greater';
  return errors;
}

export function bufferFormToPennies(form) {
  if (form.buffer === '' || form.buffer == null) return 0;
  return poundsToPennies(form.buffer);
}
