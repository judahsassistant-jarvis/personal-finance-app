import { useState, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { X } from 'lucide-react';
import { addDebt, editDebt } from '../../store/debtsSlice.js';
import {
  DEBT_SUBTYPES,
  CARD_LIKE_SUBTYPES,
  INSTALLMENT_SUBTYPES,
  REVOLVING_SUBTYPES,
} from '../../firebase/schema.js';
import {
  emptyDebtForm,
  debtToForm,
  validateDebtForm,
  debtFormToPayload,
} from './formHelpers.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../ui/card.jsx';
import { Input } from '../ui/input.jsx';
import { Button } from '../ui/button.jsx';

const SUBTYPE_OPTIONS = [
  { value: DEBT_SUBTYPES.CARD, label: 'Credit card' },
  { value: DEBT_SUBTYPES.STORE_CARD, label: 'Store card' },
  { value: DEBT_SUBTYPES.PERSONAL_LOAN, label: 'Personal loan' },
  { value: DEBT_SUBTYPES.BNPL, label: 'Buy now, pay later' },
  { value: DEBT_SUBTYPES.OVERDRAFT, label: 'Overdraft' },
];

export default function DebtForm({ editingDebt, onClose }) {
  const dispatch = useDispatch();
  const [form, setForm] = useState(editingDebt ? debtToForm(editingDebt) : { ...emptyDebtForm });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(editingDebt ? debtToForm(editingDebt) : { ...emptyDebtForm });
    setErrors({});
    setSubmitError(null);
  }, [editingDebt]);

  const isCardLike = CARD_LIKE_SUBTYPES.has(form.subtype);
  const isInstallment = INSTALLMENT_SUBTYPES.has(form.subtype);
  const isRevolving = REVOLVING_SUBTYPES.has(form.subtype);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    const errs = validateDebtForm(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    try {
      const payload = debtFormToPayload(form);
      if (editingDebt) {
        await dispatch(editDebt({ id: editingDebt.id, ...payload })).unwrap();
      } else {
        await dispatch(addDebt(payload)).unwrap();
      }
      onClose();
    } catch (err) {
      setSubmitError(err?.message || 'Failed to save debt');
    } finally {
      setSaving(false);
    }
  };

  const field = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>{editingDebt ? 'Edit debt' : 'Add debt'}</CardTitle>
            <CardDescription>
              {isCardLike
                ? 'For credit / balance-transfer / store cards. Balance is tracked via buckets.'
                : isInstallment
                ? 'Fixed-term debts (personal loan, BNPL plan). Balance, fixed monthly payment, and remaining term.'
                : 'Revolving debt with a credit limit and standard APR.'}
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} type="button">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {submitError && (
            <div className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
              {submitError}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <LabeledField label="Debt type" error={errors.subtype}>
              <select
                value={form.subtype}
                onChange={(e) => field('subtype', e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                {SUBTYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </LabeledField>

            <LabeledField label="Name" error={errors.name}>
              <Input
                placeholder="e.g. Barclaycard Platinum"
                value={form.name}
                onChange={(e) => field('name', e.target.value)}
              />
            </LabeledField>

            {!isCardLike && (
              <LabeledField
                label="Current balance (£)"
                error={errors.balance}
                hint={isInstallment ? 'Principal remaining' : 'Amount owed'}
              >
                <Input
                  type="number" step="0.01" min="0"
                  value={form.balance}
                  onChange={(e) => field('balance', e.target.value)}
                />
              </LabeledField>
            )}

            {isInstallment && (
              <LabeledField
                label="Starting balance (£)"
                error={errors.starting_balance}
                hint="Used for the payoff progress bar. Defaults to current balance for a fresh debt."
              >
                <Input
                  type="number" step="0.01" min="0"
                  placeholder={form.balance || '0'}
                  value={form.starting_balance}
                  onChange={(e) => field('starting_balance', e.target.value)}
                />
              </LabeledField>
            )}

            {form.subtype !== DEBT_SUBTYPES.BNPL && (
              <LabeledField
                label={isCardLike ? 'Standard APR % (post-promo)' : 'APR %'}
                error={errors.standard_apr}
                hint="e.g. 19.9"
              >
                <Input
                  type="number" step="0.01" min="0" max="100"
                  placeholder="19.9"
                  value={form.standard_apr}
                  onChange={(e) => field('standard_apr', e.target.value)}
                />
              </LabeledField>
            )}

            {isCardLike && (
              <>
                <LabeledField label="Min payment %" error={errors.min_percentage} hint="e.g. 2.25 for 2.25%">
                  <Input
                    type="number" step="0.01" min="0" max="100"
                    value={form.min_percentage}
                    onChange={(e) => field('min_percentage', e.target.value)}
                  />
                </LabeledField>
                <LabeledField label="Min payment floor (£)" error={errors.min_floor}>
                  <Input
                    type="number" step="0.01" min="0"
                    value={form.min_floor}
                    onChange={(e) => field('min_floor', e.target.value)}
                  />
                </LabeledField>
                <LabeledField label="Credit limit (£)" error={errors.limit} hint="Optional">
                  <Input
                    type="number" step="1" min="0"
                    value={form.limit}
                    onChange={(e) => field('limit', e.target.value)}
                  />
                </LabeledField>
                <LabeledField label="Statement day" error={errors.statement_day} hint="1–31, optional">
                  <Input
                    type="number" min="1" max="31"
                    value={form.statement_day}
                    onChange={(e) => field('statement_day', e.target.value)}
                  />
                </LabeledField>
              </>
            )}

            {isInstallment && (
              <>
                <LabeledField label="Fixed monthly payment (£)" error={errors.fixed_payment}>
                  <Input
                    type="number" step="0.01" min="0"
                    value={form.fixed_payment}
                    onChange={(e) => field('fixed_payment', e.target.value)}
                  />
                </LabeledField>
                <LabeledField label="Term remaining (months)" error={errors.term_months}>
                  <Input
                    type="number" step="1" min="1"
                    value={form.term_months}
                    onChange={(e) => field('term_months', e.target.value)}
                  />
                </LabeledField>
                <LabeledField label="Start date" hint="Optional">
                  <Input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => field('start_date', e.target.value)}
                  />
                </LabeledField>
              </>
            )}

            {isRevolving && (
              <LabeledField label="Limit (£)" error={errors.limit} hint="Optional">
                <Input
                  type="number" step="1" min="0"
                  value={form.limit}
                  onChange={(e) => field('limit', e.target.value)}
                />
              </LabeledField>
            )}

            <LabeledField label="Payment due day" error={errors.payment_due_day} hint="1–31, for reminders">
              <Input
                type="number" min="1" max="31"
                value={form.payment_due_day}
                onChange={(e) => field('payment_due_day', e.target.value)}
              />
            </LabeledField>

            <label className="flex items-center gap-2 text-sm mt-6">
              <input
                type="checkbox"
                checked={form.priority}
                onChange={(e) => field('priority', e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <span>Flag as priority</span>
            </label>

            {form.payment_due_day !== '' && (
              <label className="flex items-center gap-2 text-sm mt-6">
                <input
                  type="checkbox"
                  checked={form.reminders_enabled}
                  onChange={(e) => field('reminders_enabled', e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                <span>Send payment reminders via email</span>
              </label>
            )}
          </div>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : editingDebt ? 'Save changes' : 'Add debt'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function LabeledField({ label, hint, error, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
