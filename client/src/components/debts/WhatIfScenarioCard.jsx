import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ArrowLeftRight, ChevronDown, ChevronUp, TrendingDown } from 'lucide-react';
import { runForecast } from '../../services/debtForecast.js';
import { computeDiscretionary } from '../../services/discretionary.js';
import {
  STRATEGIES, DEFAULT_PAY_CYCLE, formatGBP, CARD_LIKE_SUBTYPES,
} from '../../firebase/schema.js';
import { ensureDebtConfig } from '../../store/debtConfigSlice.js';
import { fetchAccounts } from '../../store/accountsSlice.js';
import { fetchTransactions } from '../../store/transactionsSlice.js';
import { fetchRecurringBills } from '../../store/recurringBillsSlice.js';
import { fetchBankHolidays } from '../../store/systemSlice.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card.jsx';
import { Button } from '../ui/button.jsx';
import { Input } from '../ui/input.jsx';
import {
  pickEffectiveBudget,
  getForecastStartMonth,
  formatMonthsDuration,
  formatPayoffMonth,
} from './strategyComparisonHelpers.js';
import {
  WHAT_IF_MODES,
  computeWhatIfImpact,
  whatIfInputsValid,
  poundsInputToPennies,
  percentInputToDecimal,
  intInput,
} from './whatIfHelpers.js';

const HORIZON_MONTHS = 360;

const TABS = [
  { key: WHAT_IF_MODES.SINGLE, label: 'Transfer one debt' },
  { key: WHAT_IF_MODES.MULTI,  label: "I have an offer" },
];

export default function WhatIfScenarioCard({ debts, buckets }) {
  const dispatch = useDispatch();
  const config = useSelector((s) => s.debtConfig.doc);
  const profile = useSelector((s) => s.auth.profile);
  const accounts = useSelector((s) => s.accounts.items);
  const bills = useSelector((s) => s.recurringBills.items);
  const transactions = useSelector((s) => s.transactions.items);
  const bankHolidays = useSelector((s) => s.system.bankHolidays);

  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState(WHAT_IF_MODES.SINGLE);

  // Single-mode form. `sourceDebtIdState === null` means "use the first
  // candidate as the default" — derived inline below so we don't need an
  // effect+setState dance to initialise it.
  const [sourceDebtIdState, setSourceDebtId] = useState(null);
  const [transferAmount, setTransferAmount] = useState('');

  // Multi-mode form. Same pattern: null means "default to all candidates".
  const [availableLimit, setAvailableLimit] = useState('');
  const [eligibleDebtIdsState, setEligibleDebtIds] = useState(null);

  // Shared BT card spec
  const [standardApr, setStandardApr] = useState('21.9');
  const [promoApr, setPromoApr] = useState('0');
  const [promoMonths, setPromoMonths] = useState('12');
  const [feePercent, setFeePercent] = useState('3');

  useEffect(() => {
    dispatch(ensureDebtConfig());
    dispatch(fetchAccounts());
    dispatch(fetchTransactions());
    dispatch(fetchRecurringBills());
    dispatch(fetchBankHolidays());
  }, [dispatch]);

  const startMonth = useMemo(
    () => getForecastStartMonth({ payCycle: profile?.pay_cycle, holidayCache: bankHolidays }),
    [profile, bankHolidays],
  );

  const totalMinPennies = useMemo(() => {
    const minOnly = runForecast({ debts, buckets, startMonth, months: HORIZON_MONTHS, minOnly: true });
    return minOnly.months[0]?.minimum_payments_pennies ?? 0;
  }, [debts, buckets, startMonth]);

  const discretionaryPennies = useMemo(() => {
    if (!profile) return null;
    const payCycle = profile.pay_cycle || DEFAULT_PAY_CYCLE;
    const calc = computeDiscretionary({
      accounts, debts, bills, transactions,
      payCycle, holidayCache: bankHolidays,
      bufferPennies: Number(profile.buffer_pennies ?? 0),
    });
    return calc?.discretionary_pennies ?? null;
  }, [profile, accounts, debts, bills, transactions, bankHolidays]);

  const effectiveBudget = useMemo(() => pickEffectiveBudget({
    autoSuggestEnabled: config?.auto_suggest_budget ?? true,
    discretionaryPennies,
    totalMinPennies,
    savedBudget: config?.monthly_budget_pennies ?? null,
  }), [config, discretionaryPennies, totalMinPennies]);

  const strategy = config?.strategy ?? STRATEGIES.AVALANCHE;

  // Build the candidate source list (debts that have a balance to transfer).
  const sourceCandidates = useMemo(() => {
    return debts
      .map((d) => ({
        debt: d,
        balance: balanceForDebt(d, buckets),
      }))
      .filter((c) => c.balance > 0);
  }, [debts, buckets]);

  // Effective form values: user's explicit pick when set, else sensible default.
  const sourceDebtId = sourceDebtIdState ?? sourceCandidates[0]?.debt.id ?? '';
  const eligibleDebtIds = useMemo(() => {
    if (eligibleDebtIdsState !== null) return eligibleDebtIdsState;
    return new Set(sourceCandidates.map((c) => c.debt.id));
  }, [eligibleDebtIdsState, sourceCandidates]);

  const transferPennies = poundsInputToPennies(transferAmount);
  const availableLimitPennies = poundsInputToPennies(availableLimit);
  const standardAprDec = percentInputToDecimal(standardApr);
  const promoAprDec = percentInputToDecimal(promoApr);
  const feePercentDec = percentInputToDecimal(feePercent);
  const promoMonthsInt = intInput(promoMonths);

  const fields = mode === WHAT_IF_MODES.SINGLE
    ? {
        sourceDebtId,
        transferPennies,
        standardApr: standardAprDec,
        promoApr: promoAprDec,
        promoMonths: promoMonthsInt,
        feePercent: feePercentDec,
      }
    : {
        availableLimitPennies,
        eligibleDebtIds: Array.from(eligibleDebtIds),
        standardApr: standardAprDec,
        promoApr: promoAprDec,
        promoMonths: promoMonthsInt,
        feePercent: feePercentDec,
      };

  const inputsValid = whatIfInputsValid(mode, fields);

  const impact = useMemo(() => {
    if (!expanded || !inputsValid) return null;
    const newCard = {
      name: 'BT scenario',
      standardApr: standardAprDec,
      promoApr: promoAprDec,
      promoMonths: promoMonthsInt,
      feePercent: feePercentDec,
    };
    const params = mode === WHAT_IF_MODES.SINGLE
      ? { sourceDebtId, transferPennies, newCard, now: startMonth }
      : { availableLimitPennies, eligibleDebtIds: Array.from(eligibleDebtIds), newCard, now: startMonth };

    return computeWhatIfImpact({
      debts, buckets, startMonth, months: HORIZON_MONTHS,
      monthlyBudget: effectiveBudget, strategy,
      mode, params,
    });
  }, [
    expanded, inputsValid, mode, debts, buckets, startMonth, effectiveBudget, strategy,
    sourceDebtId, transferPennies, availableLimitPennies, eligibleDebtIds,
    standardAprDec, promoAprDec, promoMonthsInt, feePercentDec,
  ]);

  const debtNameById = useMemo(
    () => new Map(debts.map((d) => [d.id, d.name])),
    [debts],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4 text-accent-foreground" />
              What-if: balance transfer
            </CardTitle>
            <CardDescription>
              Model a 0% BT card. Either transfer one specific debt, or feed in an offer with a
              credit limit and let PFA allocate it across your debts to minimise interest.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)} className="h-8">
            {expanded ? (
              <><ChevronUp className="w-3.5 h-3.5" />Collapse</>
            ) : (
              <><ChevronDown className="w-3.5 h-3.5" />Model a BT</>
            )}
          </Button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4">
          <div className="flex items-center gap-1 rounded-md bg-muted p-1 w-fit">
            {TABS.map((t) => (
              <Button
                key={t.key}
                size="sm"
                variant={mode === t.key ? 'default' : 'ghost'}
                onClick={() => setMode(t.key)}
                className="h-7 text-xs"
              >
                {t.label}
              </Button>
            ))}
          </div>

          {mode === WHAT_IF_MODES.SINGLE ? (
            <SingleForm
              candidates={sourceCandidates}
              sourceDebtId={sourceDebtId}
              setSourceDebtId={setSourceDebtId}
              transferAmount={transferAmount}
              setTransferAmount={setTransferAmount}
            />
          ) : (
            <MultiForm
              candidates={sourceCandidates}
              eligibleDebtIds={eligibleDebtIds}
              setEligibleDebtIds={setEligibleDebtIds}
              availableLimit={availableLimit}
              setAvailableLimit={setAvailableLimit}
            />
          )}

          <NewCardSpecForm
            standardApr={standardApr} setStandardApr={setStandardApr}
            promoApr={promoApr} setPromoApr={setPromoApr}
            promoMonths={promoMonths} setPromoMonths={setPromoMonths}
            feePercent={feePercent} setFeePercent={setFeePercent}
          />

          {!inputsValid ? (
            <p className="text-sm text-muted-foreground">
              Fill in all fields above to see how this scenario plays out.
            </p>
          ) : impact ? (
            <ImpactSummary impact={impact} mode={mode} debtNameById={debtNameById} strategy={strategy} />
          ) : null}
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sub-forms
// ---------------------------------------------------------------------------

function SingleForm({ candidates, sourceDebtId, setSourceDebtId, transferAmount, setTransferAmount }) {
  const sourceBalance = candidates.find((c) => c.debt.id === sourceDebtId)?.balance ?? 0;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="Source debt">
        <select
          value={sourceDebtId}
          onChange={(e) => setSourceDebtId(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {candidates.length === 0 && <option value="">No debts available</option>}
          {candidates.map((c) => (
            <option key={c.debt.id} value={c.debt.id}>
              {c.debt.name} · {formatGBP(c.balance)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Transfer amount (£)" hint={sourceBalance > 0 ? `Up to ${formatGBP(sourceBalance)}` : null}>
        <Input
          type="number" inputMode="decimal" step="1" min="0"
          placeholder={(sourceBalance / 100).toFixed(0)}
          value={transferAmount}
          onChange={(e) => setTransferAmount(e.target.value)}
        />
      </Field>
    </div>
  );
}

function MultiForm({ candidates, eligibleDebtIds, setEligibleDebtIds, availableLimit, setAvailableLimit }) {
  const toggle = (id) => {
    const next = new Set(eligibleDebtIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setEligibleDebtIds(next);
  };
  return (
    <div className="space-y-3">
      <Field label="BT credit available (£)">
        <Input
          type="number" inputMode="decimal" step="1" min="0"
          placeholder="10000"
          value={availableLimit}
          onChange={(e) => setAvailableLimit(e.target.value)}
          className="max-w-40"
        />
      </Field>
      <Field label="Debts to consider">
        <div className="space-y-1.5">
          {candidates.length === 0 && (
            <p className="text-sm text-muted-foreground">No debts available to transfer from.</p>
          )}
          {candidates.map((c) => (
            <label key={c.debt.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={eligibleDebtIds.has(c.debt.id)}
                onChange={() => toggle(c.debt.id)}
                className="h-4 w-4 rounded border-input"
              />
              <span className="font-medium">{c.debt.name}</span>
              <span className="text-muted-foreground tabular-nums">{formatGBP(c.balance)}</span>
              {c.debt.standard_apr != null && (
                <span className="text-muted-foreground text-xs">@ {(c.debt.standard_apr * 100).toFixed(1)}%</span>
              )}
            </label>
          ))}
        </div>
      </Field>
    </div>
  );
}

function NewCardSpecForm({
  standardApr, setStandardApr,
  promoApr, setPromoApr,
  promoMonths, setPromoMonths,
  feePercent, setFeePercent,
}) {
  return (
    <div className="rounded-md border border-border p-3 space-y-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">New BT card terms</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="Promo APR %" hint="usually 0">
          <Input type="number" step="0.1" min="0" value={promoApr} onChange={(e) => setPromoApr(e.target.value)} />
        </Field>
        <Field label="Promo months">
          <Input type="number" step="1" min="0" value={promoMonths} onChange={(e) => setPromoMonths(e.target.value)} />
        </Field>
        <Field label="Post-promo APR %">
          <Input type="number" step="0.1" min="0" value={standardApr} onChange={(e) => setStandardApr(e.target.value)} />
        </Field>
        <Field label="Fee %" hint="of transferred balance">
          <Input type="number" step="0.1" min="0" value={feePercent} onChange={(e) => setFeePercent(e.target.value)} />
        </Field>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Impact summary
// ---------------------------------------------------------------------------

function ImpactSummary({ impact, mode, debtNameById, strategy }) {
  const { baseline, withBt, interestSavedPennies, monthsSaved, feePennies, netSavingsPennies, allocations, transferPennies } = impact;
  const noChange = interestSavedPennies === 0 && monthsSaved === 0;

  return (
    <div className="space-y-3">
      {mode === WHAT_IF_MODES.MULTI && allocations && allocations.length > 0 && (
        <AllocationBreakdown allocations={allocations} debtNameById={debtNameById} feePennies={feePennies} />
      )}

      {noChange ? (
        <div className="rounded-md border border-muted-foreground/20 bg-muted p-3 text-sm text-muted-foreground">
          This BT scenario doesn&apos;t change the total interest or payoff date — usually because the
          fee cancels out the rate saving, or the source debt was already paid off quickly under
          the current strategy.
        </div>
      ) : (
        <div className={`rounded-md border p-3 ${netSavingsPennies > 0 ? 'border-positive bg-positive/5' : 'border-warning bg-warning/15'}`}>
          <div className="flex items-center gap-2 text-sm font-medium">
            <TrendingDown className={`w-4 h-4 ${netSavingsPennies > 0 ? 'text-positive' : 'text-warning-foreground'}`} />
            {netSavingsPennies > 0 ? (
              <span className="text-positive">
                Net saving {formatGBP(netSavingsPennies)} after the {formatGBP(feePennies)} BT fee
                {monthsSaved > 0 && <>, {formatMonthsDuration(monthsSaved)} faster</>}
              </span>
            ) : (
              <span className="text-warning-foreground">
                The {formatGBP(feePennies)} BT fee outweighs the {formatGBP(interestSavedPennies)} interest saved — net loss of {formatGBP(Math.abs(netSavingsPennies))}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Under the <span className="font-medium">{strategy}</span> strategy at your current budget.
            Total transferred: {formatGBP(transferPennies)}.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <ImpactTile
          title="Without the BT"
          interest={baseline.totalInterestPennies}
          months={baseline.monthsToPayoff}
          debtFreeMonth={baseline.debtFreeMonth}
        />
        <ImpactTile
          title="With the BT"
          interest={withBt.totalInterestPennies}
          months={withBt.monthsToPayoff}
          debtFreeMonth={withBt.debtFreeMonth}
          highlight={netSavingsPennies > 0}
        />
      </div>
    </div>
  );
}

function AllocationBreakdown({ allocations, debtNameById, feePennies }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2">Greedy allocation</div>
      <ul className="space-y-1 text-sm">
        {allocations.map((a) => (
          <li key={a.debt_id} className="flex justify-between gap-3">
            <span className="truncate">
              {debtNameById.get(a.debt_id) ?? a.debt_id}
              <span className="text-muted-foreground text-xs ml-2">@ {(a.current_apr * 100).toFixed(1)}%</span>
            </span>
            <span className="tabular-nums">{formatGBP(a.transferred_pennies)}</span>
          </li>
        ))}
        {feePennies > 0 && (
          <li className="flex justify-between gap-3 pt-1.5 border-t border-border text-xs text-muted-foreground">
            <span>BT fee</span>
            <span className="tabular-nums">{formatGBP(feePennies)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}

function ImpactTile({ title, interest, months, debtFreeMonth, highlight = false }) {
  return (
    <div className={`rounded-md border p-3 ${highlight ? 'border-positive/40 bg-positive/5' : 'border-border'}`}>
      <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{title}</div>
      <div className="tabular-nums font-mono">{formatGBP(interest)} interest</div>
      <div className="text-xs text-muted-foreground tabular-nums mt-0.5">
        {formatMonthsDuration(months)}
        {debtFreeMonth && <> · debt-free {formatPayoffMonth(debtFreeMonth)}</>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function balanceForDebt(debt, buckets) {
  if (CARD_LIKE_SUBTYPES.has(debt.subtype)) {
    return buckets
      .filter((b) => b.debt_id === debt.id)
      .reduce((s, b) => s + Math.max(0, Number(b.balance_pennies || 0)), 0);
  }
  return Math.max(0, Number(debt.balance_pennies || 0));
}
