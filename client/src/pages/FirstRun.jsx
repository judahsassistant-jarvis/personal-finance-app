import { useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Navigate, useNavigate } from 'react-router-dom';
import { updateProfile } from '../store/authSlice.js';
import { addAccount } from '../store/accountsSlice.js';
import { addDebt } from '../store/debtsSlice.js';
import {
  PAY_CYCLE_CADENCE,
  SHIFT_RULES,
  ACCOUNT_SUBTYPES,
  DEBT_SUBTYPES,
  CARD_LIKE_SUBTYPES,
  INSTALLMENT_SUBTYPES,
} from '../firebase/schema.js';
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
} from '../components/firstrun/firstRunHelpers.js';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
} from '../components/ui/card.jsx';
import { Button } from '../components/ui/button.jsx';
import { Input } from '../components/ui/input.jsx';
import { Alert, AlertDescription } from '../components/ui/alert.jsx';
import { cn } from '../lib/utils.js';

const STEPS = [
  { id: 'pay_cycle', label: 'Pay cycle' },
  { id: 'account', label: 'First account' },
  { id: 'debt', label: 'First debt' },
  { id: 'buffer', label: 'Safe-to-spend buffer' },
];

const FIELD_CLASSES = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50';

export default function FirstRun() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { profile, initialized } = useSelector((s) => s.auth);

  const [stepIndex, setStepIndex] = useState(0);
  const [payCycleForm, setPayCycleForm] = useState(() => emptyPayCycleForm(profile?.pay_cycle));
  const [accountForm, setAccountForm] = useState(emptyAccountForm);
  const [debtForm, setDebtForm] = useState(emptyDebtForm);
  const [bufferForm, setBufferForm] = useState({ buffer: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  // Already onboarded — don't let the wizard be shown again.
  if (profile?.onboarding_complete) {
    return <Navigate to="/" replace />;
  }

  async function handleContinue() {
    setSubmitError(null);
    if (step.id === 'pay_cycle') {
      const errs = validatePayCycleForm(payCycleForm);
      setErrors(errs);
      if (Object.keys(errs).length) return;
      try {
        setBusy(true);
        await dispatch(updateProfile({ pay_cycle: payCycleFormToPayload(payCycleForm) })).unwrap();
        setStepIndex(stepIndex + 1);
      } catch (e) {
        setSubmitError(e.message || 'Could not save pay cycle');
      } finally {
        setBusy(false);
      }
    } else if (step.id === 'account') {
      const errs = validateAccountForm(accountForm);
      setErrors(errs);
      if (Object.keys(errs).length) return;
      try {
        setBusy(true);
        await dispatch(addAccount(accountFormToPayload(accountForm))).unwrap();
        setStepIndex(stepIndex + 1);
      } catch (e) {
        setSubmitError(e.message || 'Could not add account');
      } finally {
        setBusy(false);
      }
    } else if (step.id === 'debt') {
      const errs = validateFirstRunDebtForm(debtForm);
      setErrors(errs);
      if (Object.keys(errs).length) return;
      try {
        setBusy(true);
        await dispatch(addDebt(firstRunDebtFormToPayload(debtForm))).unwrap();
        setStepIndex(stepIndex + 1);
      } catch (e) {
        setSubmitError(e.message || 'Could not add debt');
      } finally {
        setBusy(false);
      }
    } else if (step.id === 'buffer') {
      const errs = validateBufferForm(bufferForm);
      setErrors(errs);
      if (Object.keys(errs).length) return;
      await finish({ buffer_pennies: bufferFormToPennies(bufferForm) });
    }
  }

  async function handleSkip() {
    setSubmitError(null);
    setErrors({});
    if (isLast) {
      await finish({});
    } else {
      setStepIndex(stepIndex + 1);
    }
  }

  function handleBack() {
    if (stepIndex === 0) return;
    setErrors({});
    setSubmitError(null);
    setStepIndex(stepIndex - 1);
  }

  async function finish(extraProfileUpdates) {
    try {
      setBusy(true);
      await dispatch(updateProfile({
        ...extraProfileUpdates,
        onboarding_complete: true,
      })).unwrap();
      navigate('/', { replace: true });
    } catch (e) {
      setSubmitError(e.message || 'Could not finish setup');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4 py-8">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-xl">Welcome</CardTitle>
          <CardDescription>
            A quick setup so the app's useful from day one. Skip anything you don't want to fill in now.
          </CardDescription>
          <Stepper stepIndex={stepIndex} />
        </CardHeader>
        <CardContent className="space-y-4">
          {step.id === 'pay_cycle' && (
            <PayCycleStep form={payCycleForm} setForm={setPayCycleForm} errors={errors} />
          )}
          {step.id === 'account' && (
            <AccountStep form={accountForm} setForm={setAccountForm} errors={errors} />
          )}
          {step.id === 'debt' && (
            <DebtStep form={debtForm} setForm={setDebtForm} errors={errors} />
          )}
          {step.id === 'buffer' && (
            <BufferStep form={bufferForm} setForm={setBufferForm} errors={errors} />
          )}
          {submitError && (
            <Alert variant="destructive"><AlertDescription>{submitError}</AlertDescription></Alert>
          )}
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button
            variant="ghost"
            onClick={handleBack}
            disabled={stepIndex === 0 || busy}
          >
            Back
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleSkip}
              disabled={busy}
            >
              {step.id === 'pay_cycle' ? 'Use defaults' : 'Skip'}
            </Button>
            <Button
              variant="accent"
              onClick={handleContinue}
              disabled={busy}
            >
              {busy ? 'Saving…' : isLast ? 'Finish' : 'Continue'}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}

function Stepper({ stepIndex }) {
  return (
    <div className="flex gap-1.5 pt-3" aria-label={`Step ${stepIndex + 1} of ${STEPS.length}`}>
      {STEPS.map((s, i) => (
        <div
          key={s.id}
          className={cn(
            'h-1.5 flex-1 rounded-full transition-colors',
            i <= stepIndex ? 'bg-primary' : 'bg-muted',
          )}
        />
      ))}
    </div>
  );
}

function Field({ label, error, children, id }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function PayCycleStep({ form, setForm, errors }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        When does your main income land? This drives the discretionary calc and forecast start date.
      </p>
      <Field label="Cadence" id="pc-cadence">
        <select
          id="pc-cadence"
          className={FIELD_CLASSES}
          value={form.cadence}
          onChange={(e) => setForm({ ...form, cadence: e.target.value })}
        >
          <option value={PAY_CYCLE_CADENCE.MONTHLY}>Monthly</option>
          <option value={PAY_CYCLE_CADENCE.FOUR_WEEKLY}>Every 4 weeks</option>
          <option value={PAY_CYCLE_CADENCE.BI_WEEKLY}>Every 2 weeks</option>
          <option value={PAY_CYCLE_CADENCE.WEEKLY}>Weekly</option>
        </select>
      </Field>
      <Field label="Pay day of month" id="pc-day" error={errors.day_of_month}>
        <Input
          id="pc-day"
          type="number"
          min={1}
          max={31}
          value={form.day_of_month}
          onChange={(e) => setForm({ ...form, day_of_month: e.target.value })}
        />
      </Field>
      <Field label="If pay day is a weekend / holiday" id="pc-shift">
        <select
          id="pc-shift"
          className={FIELD_CLASSES}
          value={form.shift_rule}
          onChange={(e) => setForm({ ...form, shift_rule: e.target.value })}
        >
          <option value={SHIFT_RULES.PRECEDING_WEEKDAY}>Pay the preceding weekday</option>
          <option value={SHIFT_RULES.FOLLOWING_WEEKDAY}>Pay the following weekday</option>
          <option value={SHIFT_RULES.NONE}>Pay on the date anyway</option>
        </select>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.honour_bank_holidays}
          onChange={(e) => setForm({ ...form, honour_bank_holidays: e.target.checked })}
        />
        Honour UK bank holidays
      </label>
    </div>
  );
}

function AccountStep({ form, setForm, errors }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Add one account now — usually your main current account. You can add the rest from the Accounts page later.
      </p>
      <Field label="Name" id="acc-name" error={errors.name}>
        <Input
          id="acc-name"
          value={form.name}
          placeholder="Current Account"
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      <Field label="Type" id="acc-subtype">
        <select
          id="acc-subtype"
          className={FIELD_CLASSES}
          value={form.subtype}
          onChange={(e) => setForm({ ...form, subtype: e.target.value })}
        >
          <option value={ACCOUNT_SUBTYPES.CURRENT}>Current account</option>
          <option value={ACCOUNT_SUBTYPES.SAVINGS}>Savings</option>
          <option value={ACCOUNT_SUBTYPES.CASH_ISA}>Cash ISA</option>
          <option value={ACCOUNT_SUBTYPES.SS_ISA}>Stocks & Shares ISA</option>
          <option value={ACCOUNT_SUBTYPES.SIPP}>SIPP</option>
          <option value={ACCOUNT_SUBTYPES.INVESTMENT}>Investment</option>
          <option value={ACCOUNT_SUBTYPES.PENSION}>Pension</option>
        </select>
      </Field>
      <Field label="Balance (£)" id="acc-balance" error={errors.balance}>
        <Input
          id="acc-balance"
          type="number"
          step="0.01"
          value={form.balance}
          onChange={(e) => setForm({ ...form, balance: e.target.value })}
        />
      </Field>
    </div>
  );
}

function DebtStep({ form, setForm, errors }) {
  const isCard = CARD_LIKE_SUBTYPES.has(form.subtype);
  const isInstallment = INSTALLMENT_SUBTYPES.has(form.subtype);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Add one debt to get started. You can add more (and promo buckets) from the Debt Planner later.
      </p>
      <Field label="Name" id="d-name" error={errors.name}>
        <Input
          id="d-name"
          value={form.name}
          placeholder="Barclaycard"
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      <Field label="Type" id="d-subtype">
        <select
          id="d-subtype"
          className={FIELD_CLASSES}
          value={form.subtype}
          onChange={(e) => setForm({ ...form, subtype: e.target.value })}
        >
          <option value={DEBT_SUBTYPES.CARD}>Credit card</option>
          <option value={DEBT_SUBTYPES.STORE_CARD}>Store card</option>
          <option value={DEBT_SUBTYPES.BNPL}>Buy now, pay later</option>
          <option value={DEBT_SUBTYPES.PERSONAL_LOAN}>Personal loan</option>
          <option value={DEBT_SUBTYPES.OVERDRAFT}>Overdraft</option>
        </select>
      </Field>
      {!isCard && (
        <Field label="Balance (£)" id="d-balance" error={errors.balance}>
          <Input
            id="d-balance"
            type="number"
            step="0.01"
            value={form.balance}
            onChange={(e) => setForm({ ...form, balance: e.target.value })}
          />
        </Field>
      )}
      {isCard && (
        <p className="text-xs text-muted-foreground">
          Cards hold balances in buckets (purchases, balance transfers, promos). Add those on the Debt Planner page.
        </p>
      )}
      {form.subtype !== DEBT_SUBTYPES.BNPL && (
        <Field label="Standard APR (%)" id="d-apr" error={errors.standard_apr}>
          <Input
            id="d-apr"
            type="number"
            step="0.01"
            placeholder="19.9"
            value={form.standard_apr}
            onChange={(e) => setForm({ ...form, standard_apr: e.target.value })}
          />
        </Field>
      )}
      {isInstallment && (
        <>
          <Field label="Fixed monthly payment (£)" id="d-fixed" error={errors.fixed_payment}>
            <Input
              id="d-fixed"
              type="number"
              step="0.01"
              value={form.fixed_payment}
              onChange={(e) => setForm({ ...form, fixed_payment: e.target.value })}
            />
          </Field>
          <Field label="Term (months)" id="d-term" error={errors.term_months}>
            <Input
              id="d-term"
              type="number"
              min={1}
              value={form.term_months}
              onChange={(e) => setForm({ ...form, term_months: e.target.value })}
            />
          </Field>
        </>
      )}
    </div>
  );
}

function BufferStep({ form, setForm, errors }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Optional: a float you'll always leave in your current account. The Dashboard's safe-to-spend number stays above this. Leave blank for £0.
      </p>
      <Field label="Buffer (£)" id="buf" error={errors.buffer}>
        <Input
          id="buf"
          type="number"
          step="0.01"
          min={0}
          placeholder="e.g. 200"
          value={form.buffer}
          onChange={(e) => setForm({ ...form, buffer: e.target.value })}
        />
      </Field>
    </div>
  );
}
