/**
 * Validation and marshalling helpers for the debt and bucket forms.
 * Kept separate from the component files so fast-refresh works cleanly.
 */
import { Timestamp } from 'firebase/firestore';
import {
  DEBT_SUBTYPES,
  CARD_LIKE_SUBTYPES,
  INSTALLMENT_SUBTYPES,
  REVOLVING_SUBTYPES,
  poundsToPennies,
  penniesToPounds,
} from '../../firebase/schema.js';

// Percent vs decimal:
// All user-facing inputs (APR, min_percentage) are entered as percent (e.g. "19.9"
// for 19.9%). The Firestore schema stores decimals (0.199). Conversion happens at
// the form boundary via decimalToPercentString / percentStringToDecimal.

export const emptyDebtForm = {
  name: '',
  subtype: DEBT_SUBTYPES.CARD,
  balance: '',
  standard_apr: '',
  min_percentage: '2',
  min_floor: '25',
  limit: '',
  statement_day: '',
  fixed_payment: '',
  term_months: '',
  start_date: '',
  payment_due_day: '',
  priority: false,
};

export function decimalToPercentString(d) {
  if (d == null || !Number.isFinite(Number(d))) return '';
  // Round to 3dp of the percent to absorb FP drift (0.199 * 100 = 19.900000...2).
  return String(Number((Number(d) * 100).toFixed(3)));
}

export function percentStringToDecimal(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  // Round to 5dp of the decimal = 3dp of the percent. Keeps the store exact.
  return Math.round(n * 1000) / 100000;
}

export function debtToForm(debt) {
  return {
    name: debt.name ?? '',
    subtype: debt.subtype ?? DEBT_SUBTYPES.CARD,
    balance: CARD_LIKE_SUBTYPES.has(debt.subtype)
      ? ''
      : debt.balance_pennies != null ? String(penniesToPounds(debt.balance_pennies)) : '',
    standard_apr: decimalToPercentString(debt.standard_apr),
    min_percentage: debt.min_percentage != null ? decimalToPercentString(debt.min_percentage) : '2',
    min_floor: debt.min_floor_pennies != null ? String(penniesToPounds(debt.min_floor_pennies)) : '25',
    limit: debt.limit_pennies != null ? String(penniesToPounds(debt.limit_pennies)) : '',
    statement_day: debt.statement_day != null ? String(debt.statement_day) : '',
    fixed_payment: debt.fixed_payment_pennies != null ? String(penniesToPounds(debt.fixed_payment_pennies)) : '',
    term_months: debt.term_months != null ? String(debt.term_months) : '',
    start_date: debt.start_date != null ? toDateInputValue(debt.start_date) : '',
    payment_due_day: debt.payment_due_day != null ? String(debt.payment_due_day) : '',
    priority: !!debt.priority,
  };
}

export function toDateInputValue(v) {
  const d = typeof v === 'number' ? new Date(v) : v instanceof Date ? v : null;
  if (!d || isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export function validateDebtForm(form) {
  const errors = {};
  if (!form.name || form.name.trim().length < 1) errors.name = 'Name is required';

  const isCardLike = CARD_LIKE_SUBTYPES.has(form.subtype);
  const isInstallment = INSTALLMENT_SUBTYPES.has(form.subtype);
  const isRevolving = REVOLVING_SUBTYPES.has(form.subtype);

  if (!isCardLike) {
    if (form.balance === '' || form.balance == null) {
      errors.balance = 'Balance is required';
    } else {
      const bal = Number(form.balance);
      if (!Number.isFinite(bal) || bal < 0) errors.balance = 'Must be 0 or greater';
    }
  }

  if (form.standard_apr !== '' && form.standard_apr != null) {
    const apr = Number(form.standard_apr);
    if (!Number.isFinite(apr) || apr < 0) errors.standard_apr = 'APR must be 0 or greater';
    else if (apr > 100) errors.standard_apr = 'Enter as percent (e.g. 19.9)';
  } else if (form.subtype !== DEBT_SUBTYPES.BNPL) {
    errors.standard_apr = 'APR is required';
  }

  if (isCardLike) {
    const mp = Number(form.min_percentage);
    if (!Number.isFinite(mp) || mp < 0 || mp > 100) errors.min_percentage = 'Enter as percent (e.g. 2)';
    const mf = Number(form.min_floor);
    if (!Number.isFinite(mf) || mf < 0) errors.min_floor = 'Must be 0 or greater';
  }

  if (form.limit !== '' && form.limit != null) {
    const lim = Number(form.limit);
    if (!Number.isFinite(lim) || lim < 0) errors.limit = 'Must be 0 or greater';
  }

  if (isCardLike && form.statement_day !== '') {
    const sd = Number(form.statement_day);
    if (!Number.isInteger(sd) || sd < 1 || sd > 31) errors.statement_day = 'Must be 1–31';
  }

  if (isInstallment) {
    if (form.fixed_payment === '') errors.fixed_payment = 'Required';
    else {
      const fp = Number(form.fixed_payment);
      if (!Number.isFinite(fp) || fp < 0) errors.fixed_payment = 'Must be 0 or greater';
    }
    if (form.term_months === '') errors.term_months = 'Required';
    else {
      const tm = Number(form.term_months);
      if (!Number.isInteger(tm) || tm < 1) errors.term_months = 'Must be 1 or more';
    }
  }

  if (form.payment_due_day !== '') {
    const pd = Number(form.payment_due_day);
    if (!Number.isInteger(pd) || pd < 1 || pd > 31) errors.payment_due_day = 'Must be 1–31';
  }

  if (!isCardLike && !isInstallment && !isRevolving) {
    errors.subtype = 'Select a debt type';
  }

  return errors;
}

export function debtFormToPayload(form) {
  const isCardLike = CARD_LIKE_SUBTYPES.has(form.subtype);
  const isInstallment = INSTALLMENT_SUBTYPES.has(form.subtype);
  const payload = {
    name: form.name.trim(),
    subtype: form.subtype,
    priority: !!form.priority,
  };
  if (!isCardLike) {
    payload.balance_pennies = poundsToPennies(form.balance);
  } else {
    payload.balance_pennies = 0; // derived from buckets
  }
  if (form.standard_apr !== '') payload.standard_apr = percentStringToDecimal(form.standard_apr);
  if (isCardLike) {
    payload.min_percentage = percentStringToDecimal(form.min_percentage);
    payload.min_floor_pennies = poundsToPennies(form.min_floor);
    if (form.limit !== '') payload.limit_pennies = poundsToPennies(form.limit);
    if (form.statement_day !== '') payload.statement_day = Number(form.statement_day);
  }
  if (isInstallment) {
    payload.fixed_payment_pennies = poundsToPennies(form.fixed_payment);
    payload.term_months = Number(form.term_months);
    if (form.start_date) payload.start_date = Timestamp.fromDate(new Date(form.start_date));
  }
  if (!isCardLike && !isInstallment && form.limit !== '') {
    payload.limit_pennies = poundsToPennies(form.limit);
  }
  if (form.payment_due_day !== '') payload.payment_due_day = Number(form.payment_due_day);
  return payload;
}

// --------------------------------------------------------------------------
// Bucket form
// --------------------------------------------------------------------------

export const emptyBucketForm = {
  name: '',
  balance: '',
  apr: '',
  is_promo: false,
  promo_end: '',
};

export function bucketToForm(b) {
  return {
    name: b.name ?? '',
    balance: b.balance_pennies != null ? String(penniesToPounds(b.balance_pennies)) : '',
    apr: decimalToPercentString(b.apr),
    is_promo: !!b.is_promo,
    promo_end: b.promo_end ? toDateInputValue(b.promo_end) : '',
  };
}

export function validateBucketForm(form) {
  const errors = {};
  if (!form.name || form.name.trim().length < 1) errors.name = 'Bucket name is required';
  if (form.balance === '' || form.balance == null) errors.balance = 'Balance is required';
  else {
    const bal = Number(form.balance);
    if (!Number.isFinite(bal) || bal < 0) errors.balance = 'Must be 0 or greater';
  }
  if (form.apr === '' || form.apr == null) errors.apr = 'APR required';
  else {
    const apr = Number(form.apr);
    if (!Number.isFinite(apr) || apr < 0) errors.apr = 'APR must be 0 or greater';
    else if (apr > 100) errors.apr = 'Enter as percent (e.g. 19.9)';
  }
  if (form.is_promo && !form.promo_end) errors.promo_end = 'Promo end date required when promo is on';
  return errors;
}

export function bucketFormToPayload(form, debtId) {
  const payload = {
    debt_id: debtId,
    name: form.name.trim(),
    balance_pennies: poundsToPennies(form.balance),
    apr: percentStringToDecimal(form.apr),
    is_promo: !!form.is_promo,
  };
  if (form.is_promo && form.promo_end) {
    payload.promo_end = Timestamp.fromDate(new Date(form.promo_end));
  }
  return payload;
}
