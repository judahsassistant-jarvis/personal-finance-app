import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { X } from 'lucide-react';
import { addAccount, editAccount } from '../../store/accountsSlice.js';
import { ACCOUNT_SUBTYPES } from '../../firebase/schema.js';
import {
  emptyAccountFormState,
  accountToForm,
  applySubtypeChange,
  validateAccountForm,
  accountFormToPayload,
  accountFormToEditPatch,
  RATE_BEARING_SUBTYPES,
  CONTRIBUTION_SUBTYPES,
} from './accountFormHelpers.js';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card.jsx';
import { Input } from '../ui/input.jsx';
import { Button } from '../ui/button.jsx';
import { Alert, AlertDescription } from '../ui/alert.jsx';

const FIELD_CLASSES = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50';

const SUBTYPE_LABELS = {
  [ACCOUNT_SUBTYPES.CURRENT]: 'Current account',
  [ACCOUNT_SUBTYPES.SAVINGS]: 'Savings',
  [ACCOUNT_SUBTYPES.CASH_ISA]: 'Cash ISA',
  [ACCOUNT_SUBTYPES.SS_ISA]: 'Stocks & Shares ISA',
  [ACCOUNT_SUBTYPES.SIPP]: 'SIPP',
  [ACCOUNT_SUBTYPES.INVESTMENT]: 'Investment',
  [ACCOUNT_SUBTYPES.PENSION]: 'Pension',
};

const RATE_LABEL_LIQUID = 'Interest rate (% annual)';
const RATE_LABEL_LOCKED = 'Growth rate (% annual)';
const LOCKED_SUBTYPES = new Set([
  ACCOUNT_SUBTYPES.SS_ISA,
  ACCOUNT_SUBTYPES.SIPP,
  ACCOUNT_SUBTYPES.INVESTMENT,
  ACCOUNT_SUBTYPES.PENSION,
]);

/**
 * Inline add/edit form for accounts. Props:
 *   mode: 'add' | { mode: 'edit', account }
 *   onClose: () => void
 */
export default function AccountForm({ mode, onClose }) {
  const dispatch = useDispatch();
  const isEdit = typeof mode === 'object' && mode?.mode === 'edit';
  const existing = isEdit ? mode.account : null;

  const [form, setForm] = useState(() =>
    existing ? accountToForm(existing) : emptyAccountFormState(),
  );
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [saving, setSaving] = useState(false);

  // If the parent passes a fresh account mid-mount, sync the form.
  useEffect(() => {
    if (existing) setForm(accountToForm(existing));
  }, [existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const errs = validateAccountForm(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    setSubmitError(null);
    try {
      if (isEdit) {
        const patch = accountFormToEditPatch(form, existing);
        await dispatch(editAccount({ id: existing.id, ...patch })).unwrap();
      } else {
        await dispatch(addAccount(accountFormToPayload(form))).unwrap();
      }
      onClose?.();
    } catch (e) {
      setSubmitError(e.message || 'Could not save account');
    } finally {
      setSaving(false);
    }
  }

  const showRate = RATE_BEARING_SUBTYPES.has(form.subtype);
  const showContribution = CONTRIBUTION_SUBTYPES.has(form.subtype);
  const rateLabel = LOCKED_SUBTYPES.has(form.subtype) ? RATE_LABEL_LOCKED : RATE_LABEL_LIQUID;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <CardTitle>{isEdit ? `Edit ${existing?.name ?? 'account'}` : 'Add account'}</CardTitle>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close form">
          <X className="w-4 h-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name" id="a-name" error={errors.name}>
            <Input
              id="a-name"
              value={form.name}
              placeholder="Current Account"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Type" id="a-subtype" error={errors.subtype}>
            <select
              id="a-subtype"
              className={FIELD_CLASSES}
              value={form.subtype}
              onChange={(e) => setForm(applySubtypeChange(form, e.target.value))}
            >
              {Object.values(ACCOUNT_SUBTYPES).map((s) => (
                <option key={s} value={s}>{SUBTYPE_LABELS[s]}</option>
              ))}
            </select>
          </Field>
          <Field label="Balance (£)" id="a-balance" error={errors.balance}>
            <Input
              id="a-balance"
              type="number"
              step="0.01"
              value={form.balance}
              onChange={(e) => setForm({ ...form, balance: e.target.value })}
            />
          </Field>
          {showRate && (
            <Field label={rateLabel} id="a-rate" error={errors.rate}>
              <Input
                id="a-rate"
                type="number"
                step="0.01"
                placeholder="e.g. 4.5"
                value={form.rate}
                onChange={(e) => setForm({ ...form, rate: e.target.value })}
              />
            </Field>
          )}
          {form.subtype === ACCOUNT_SUBTYPES.SIPP && (
            <Field label="Qualifying age" id="a-sipp" error={errors.sipp_age}>
              <Input
                id="a-sipp"
                type="number"
                min={50}
                max={75}
                placeholder="e.g. 58"
                value={form.sipp_age}
                onChange={(e) => setForm({ ...form, sipp_age: e.target.value })}
              />
            </Field>
          )}
          {form.subtype === ACCOUNT_SUBTYPES.PENSION && (
            <Field label="Qualifying age" id="a-pension" error={errors.pension_age}>
              <Input
                id="a-pension"
                type="number"
                min={50}
                max={75}
                placeholder="e.g. 65"
                value={form.pension_age}
                onChange={(e) => setForm({ ...form, pension_age: e.target.value })}
              />
            </Field>
          )}
          {showContribution && (
            <Field label="Monthly contribution (£)" id="a-contrib" error={errors.monthly_contribution}>
              <Input
                id="a-contrib"
                type="number"
                step="0.01"
                min={0}
                placeholder="Optional"
                value={form.monthly_contribution}
                onChange={(e) => setForm({ ...form, monthly_contribution: e.target.value })}
              />
            </Field>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.include_in_safe_to_spend}
            onChange={(e) => setForm({ ...form, include_in_safe_to_spend: e.target.checked })}
          />
          Include in safe-to-spend / discretionary budget
        </label>

        {submitError && (
          <Alert variant="destructive"><AlertDescription>{submitError}</AlertDescription></Alert>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="accent" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add account'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, id, error, children }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
