import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { PartyPopper, ChevronDown, ChevronUp } from 'lucide-react';
import { runForecast } from '../../services/debtForecast.js';
import { computeDiscretionary } from '../../services/discretionary.js';
import { STRATEGIES, DEFAULT_PAY_CYCLE, formatGBP } from '../../firebase/schema.js';
import { ensureDebtConfig } from '../../store/debtConfigSlice.js';
import { fetchAccounts } from '../../store/accountsSlice.js';
import { fetchTransactions } from '../../store/transactionsSlice.js';
import { fetchRecurringBills } from '../../store/recurringBillsSlice.js';
import { fetchBankHolidays } from '../../store/systemSlice.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card.jsx';
import { Button } from '../ui/button.jsx';
import { Input } from '../ui/input.jsx';
import { pickEffectiveBudget, getForecastStartMonth, formatMonthsDuration, formatPayoffMonth } from './strategyComparisonHelpers.js';
import {
  computeBonusPaymentImpact,
  dateInputToMonthIndex,
  currentMonthInputValue,
} from './bonusPaymentHelpers.js';

const HORIZON_MONTHS = 360;

export default function BonusPaymentCard({ debts, buckets }) {
  const dispatch = useDispatch();
  const config = useSelector((s) => s.debtConfig.doc);
  const profile = useSelector((s) => s.auth.profile);
  const accounts = useSelector((s) => s.accounts.items);
  const bills = useSelector((s) => s.recurringBills.items);
  const transactions = useSelector((s) => s.transactions.items);
  const bankHolidays = useSelector((s) => s.system.bankHolidays);

  const [expanded, setExpanded] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [monthInput, setMonthInput] = useState(() => currentMonthInputValue());

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
    const firstRow = minOnly.months[0];
    return firstRow ? firstRow.minimum_payments_pennies : 0;
  }, [debts, buckets, startMonth]);

  const discretionaryPennies = useMemo(() => {
    if (!profile) return null;
    const payCycle = profile.pay_cycle || DEFAULT_PAY_CYCLE;
    const calc = computeDiscretionary({
      accounts, debts, bills, transactions,
      payCycle,
      holidayCache: bankHolidays,
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

  const amountPennies = parseAmountInput(amountInput);
  const injectionMonthIndex = dateInputToMonthIndex(monthInput, startMonth);
  const inputsValid = amountPennies != null && amountPennies > 0 && injectionMonthIndex != null;

  const impact = useMemo(() => {
    if (!inputsValid || !expanded) return null;
    return computeBonusPaymentImpact({
      debts, buckets, startMonth,
      months: HORIZON_MONTHS,
      monthlyBudget: effectiveBudget,
      strategy,
      injectionMonthIndex,
      amountPennies,
    });
  }, [inputsValid, expanded, debts, buckets, startMonth, effectiveBudget, strategy, injectionMonthIndex, amountPennies]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <PartyPopper className="w-4 h-4 text-positive" />
              Got extra money?
            </CardTitle>
            <CardDescription>
              Model a one-off bonus payment — tax refund, work bonus, inheritance — and see how much
              time and interest it saves.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)} className="h-8">
            {expanded ? (
              <><ChevronUp className="w-3.5 h-3.5" />Collapse</>
            ) : (
              <><ChevronDown className="w-3.5 h-3.5" />Model a bonus</>
            )}
          </Button>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <LabeledField label="Bonus amount">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">£</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="1"
                  min="0"
                  placeholder="500"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="max-w-40"
                />
              </div>
            </LabeledField>
            <LabeledField label="Target month">
              <Input
                type="month"
                value={monthInput}
                onChange={(e) => setMonthInput(e.target.value)}
                className="max-w-48"
              />
            </LabeledField>
          </div>
          {!inputsValid ? (
            <p className="text-sm text-muted-foreground">
              Enter a positive amount and a target month in the future (or this month) to see the impact.
            </p>
          ) : impact ? (
            <ImpactSummary impact={impact} amountPennies={amountPennies} strategy={strategy} />
          ) : null}
        </CardContent>
      )}
    </Card>
  );
}

function LabeledField({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}

function ImpactSummary({ impact, amountPennies, strategy }) {
  const { baseline, withBonus, interestSavedPennies, monthsSaved } = impact;
  const noEffect = interestSavedPennies === 0 && monthsSaved === 0;

  if (noEffect) {
    return (
      <div className="rounded-md border border-muted-foreground/20 bg-muted p-3 text-sm text-muted-foreground">
        A {formatGBP(amountPennies)} injection at that month doesn&apos;t change the total interest or payoff
        date under the current plan — probably because the bonus arrives after the debts are already
        cleared, or because your current budget is large enough that the injection just shifts payments
        forward in the schedule.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-positive bg-positive/5 p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-positive">
          <PartyPopper className="w-4 h-4" />
          <span>
            {interestSavedPennies > 0 && <>Saves {formatGBP(interestSavedPennies)} in interest</>}
            {interestSavedPennies > 0 && monthsSaved > 0 && ', '}
            {monthsSaved > 0 && <>clears debt {formatMonthsDuration(monthsSaved)} sooner</>}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Under the <span className="font-medium">{strategy}</span> strategy at your current budget.
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <ImpactTile
          title="Without the bonus"
          interest={baseline.totalInterestPennies}
          months={baseline.monthsToPayoff}
          debtFreeMonth={baseline.debtFreeMonth}
        />
        <ImpactTile
          title="With the bonus"
          interest={withBonus.totalInterestPennies}
          months={withBonus.monthsToPayoff}
          debtFreeMonth={withBonus.debtFreeMonth}
          highlight
        />
      </div>
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

function parseAmountInput(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
