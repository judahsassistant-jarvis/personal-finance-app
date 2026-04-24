/**
 * Validation + marshalling for the full-fat Accounts page form. Separate from
 * the minimal first-run wizard form so the latter can stay stripped-down
 * while this one covers every field supported by AccountDoc.
 */
import {
  ACCOUNT_SUBTYPES,
  LIQUIDITY,
  DEFAULT_LIQUIDITY,
  DEFAULT_RATES,
  DEFAULT_SAFE_TO_SPEND,
  poundsToPennies,
  penniesToPounds,
} from '../../firebase/schema.js';

// Subtypes that carry a `growth_rate` (locked) or `interest_rate` (liquid).
// Current accounts never compound in the projection so we hide the rate input.
export const RATE_BEARING_SUBTYPES = new Set([
  ACCOUNT_SUBTYPES.SAVINGS,
  ACCOUNT_SUBTYPES.CASH_ISA,
  ACCOUNT_SUBTYPES.SS_ISA,
  ACCOUNT_SUBTYPES.SIPP,
  ACCOUNT_SUBTYPES.INVESTMENT,
  ACCOUNT_SUBTYPES.PENSION,
]);

export const CONTRIBUTION_SUBTYPES = new Set([
  ACCOUNT_SUBTYPES.SAVINGS,
  ACCOUNT_SUBTYPES.CASH_ISA,
  ACCOUNT_SUBTYPES.SS_ISA,
  ACCOUNT_SUBTYPES.SIPP,
  ACCOUNT_SUBTYPES.INVESTMENT,
  ACCOUNT_SUBTYPES.PENSION,
]);

export function emptyAccountFormState(subtype = ACCOUNT_SUBTYPES.CURRENT) {
  const defaultRate = DEFAULT_RATES[subtype];
  return {
    name: '',
    subtype,
    balance: '',
    rate: defaultRate != null ? String(defaultRate * 100) : '',
    sipp_age: '',
    pension_age: '',
    monthly_contribution: '',
    include_in_safe_to_spend: !!DEFAULT_SAFE_TO_SPEND[subtype],
  };
}

/** Convert an existing AccountDoc into form state for edit mode. */
export function accountToForm(account) {
  const annualRate = account.interest_rate ?? account.growth_rate ?? null;
  return {
    name: account.name ?? '',
    subtype: account.subtype ?? ACCOUNT_SUBTYPES.CURRENT,
    balance: account.balance_pennies != null ? String(penniesToPounds(account.balance_pennies)) : '',
    rate: annualRate != null ? String(Number((annualRate * 100).toFixed(3))) : '',
    sipp_age: account.sipp_age != null ? String(account.sipp_age) : '',
    pension_age: account.pension_age != null ? String(account.pension_age) : '',
    monthly_contribution: account.monthly_contribution_pennies != null
      ? String(penniesToPounds(account.monthly_contribution_pennies))
      : '',
    include_in_safe_to_spend: account.include_in_safe_to_spend !== false
      && account.include_in_safe_to_spend !== undefined
      ? !!account.include_in_safe_to_spend
      : !!DEFAULT_SAFE_TO_SPEND[account.subtype],
  };
}

/**
 * When the user changes subtype in-form, swap rate + include defaults to the
 * new subtype's defaults — but preserve name / balance / contribution so a
 * miskeyed type doesn't wipe typed values.
 */
export function applySubtypeChange(form, nextSubtype) {
  const nextRate = DEFAULT_RATES[nextSubtype];
  return {
    ...form,
    subtype: nextSubtype,
    rate: nextRate != null ? String(nextRate * 100) : '',
    include_in_safe_to_spend: !!DEFAULT_SAFE_TO_SPEND[nextSubtype],
    // Clear qualifying ages if leaving the subtype that owns them.
    sipp_age: nextSubtype === ACCOUNT_SUBTYPES.SIPP ? form.sipp_age : '',
    pension_age: nextSubtype === ACCOUNT_SUBTYPES.PENSION ? form.pension_age : '',
  };
}

export function validateAccountForm(form) {
  const errors = {};
  if (!form.name || form.name.trim().length < 1) errors.name = 'Name is required';
  if (!Object.values(ACCOUNT_SUBTYPES).includes(form.subtype)) errors.subtype = 'Pick a type';

  if (form.balance === '' || form.balance == null) {
    errors.balance = 'Balance is required';
  } else {
    const n = Number(form.balance);
    if (!Number.isFinite(n)) errors.balance = 'Must be a number';
  }

  if (RATE_BEARING_SUBTYPES.has(form.subtype) && form.rate !== '' && form.rate != null) {
    const r = Number(form.rate);
    if (!Number.isFinite(r) || r < 0) errors.rate = 'Rate must be 0 or greater';
    else if (r > 100) errors.rate = 'Enter as percent (e.g. 4.5)';
  }

  if (form.subtype === ACCOUNT_SUBTYPES.SIPP) {
    if (form.sipp_age === '' || form.sipp_age == null) {
      errors.sipp_age = 'Qualifying age is required for SIPP';
    } else {
      const age = Number(form.sipp_age);
      if (!Number.isInteger(age) || age < 50 || age > 75) {
        errors.sipp_age = 'Must be 50–75';
      }
    }
  }

  if (form.subtype === ACCOUNT_SUBTYPES.PENSION) {
    if (form.pension_age === '' || form.pension_age == null) {
      errors.pension_age = 'Qualifying age is required for pension';
    } else {
      const age = Number(form.pension_age);
      if (!Number.isInteger(age) || age < 50 || age > 75) {
        errors.pension_age = 'Must be 50–75';
      }
    }
  }

  if (CONTRIBUTION_SUBTYPES.has(form.subtype)
    && form.monthly_contribution !== '' && form.monthly_contribution != null) {
    const c = Number(form.monthly_contribution);
    if (!Number.isFinite(c) || c < 0) errors.monthly_contribution = 'Must be 0 or greater';
  }

  return errors;
}

/**
 * Build the payload passed to addAccount / editAccount. Resolves percent→decimal
 * for rates, pounds→pennies for monetary values, and applies liquidity based on
 * subtype so callers don't have to.
 */
export function accountFormToPayload(form) {
  const liquidity = DEFAULT_LIQUIDITY[form.subtype] ?? LIQUIDITY.LIQUID;
  const payload = {
    name: form.name.trim(),
    subtype: form.subtype,
    balance_pennies: poundsToPennies(form.balance),
    liquidity,
    include_in_safe_to_spend: !!form.include_in_safe_to_spend,
  };

  if (RATE_BEARING_SUBTYPES.has(form.subtype) && form.rate !== '' && form.rate != null) {
    const decimal = Math.round(Number(form.rate) * 1000) / 100000;
    if (liquidity === LIQUIDITY.LIQUID) {
      payload.interest_rate = decimal;
    } else {
      payload.growth_rate = decimal;
    }
  }

  if (form.subtype === ACCOUNT_SUBTYPES.SIPP && form.sipp_age !== '') {
    payload.sipp_age = Number(form.sipp_age);
  }
  if (form.subtype === ACCOUNT_SUBTYPES.PENSION && form.pension_age !== '') {
    payload.pension_age = Number(form.pension_age);
  }

  if (CONTRIBUTION_SUBTYPES.has(form.subtype)
    && form.monthly_contribution !== '' && form.monthly_contribution != null) {
    payload.monthly_contribution_pennies = poundsToPennies(form.monthly_contribution);
  }

  return payload;
}

/**
 * For edits, addAccount/editAccount take different update shapes — editAccount
 * patches fields, but fields that were previously set and are now blank need
 * to be explicitly removed. Returns a partial-update object suitable for
 * `dispatch(editAccount({ id, ...patch }))`.
 */
export function accountFormToEditPatch(form, existingAccount) {
  const payload = accountFormToPayload(form);
  // Fields that may need removal when the form blanks them out.
  if (!('interest_rate' in payload) && existingAccount.interest_rate != null) {
    payload.interest_rate = null;
  }
  if (!('growth_rate' in payload) && existingAccount.growth_rate != null) {
    payload.growth_rate = null;
  }
  if (!('sipp_age' in payload) && existingAccount.sipp_age != null) {
    payload.sipp_age = null;
  }
  if (!('pension_age' in payload) && existingAccount.pension_age != null) {
    payload.pension_age = null;
  }
  if (!('monthly_contribution_pennies' in payload)
    && existingAccount.monthly_contribution_pennies != null) {
    payload.monthly_contribution_pennies = null;
  }
  return payload;
}
