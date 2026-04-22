import { useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Target, Flame, TrendingDown, Receipt } from 'lucide-react';
import { runForecast } from '../../services/debtForecast.js';
import { computeDiscretionary } from '../../services/discretionary.js';
import { computeProgressMetrics } from '../../services/progressMetrics.js';
import { STRATEGIES, DEFAULT_PAY_CYCLE, formatGBP } from '../../firebase/schema.js';
import { ensureDebtConfig } from '../../store/debtConfigSlice.js';
import { fetchAccounts } from '../../store/accountsSlice.js';
import { fetchTransactions } from '../../store/transactionsSlice.js';
import { fetchRecurringBills } from '../../store/recurringBillsSlice.js';
import { fetchBankHolidays } from '../../store/systemSlice.js';
import { fetchBalanceSnapshots } from '../../store/balanceSnapshotsSlice.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card.jsx';
import {
  pickEffectiveBudget,
  getForecastStartMonth,
  formatPayoffMonth,
  formatMonthsDuration,
} from './strategyComparisonHelpers.js';

const HORIZON_MONTHS = 360;

export default function ProgressCard({ debts, buckets, variant = 'compact' }) {
  const dispatch = useDispatch();
  const config = useSelector((s) => s.debtConfig.doc);
  const profile = useSelector((s) => s.auth.profile);
  const accounts = useSelector((s) => s.accounts.items);
  const bills = useSelector((s) => s.recurringBills.items);
  const transactions = useSelector((s) => s.transactions.items);
  const bankHolidays = useSelector((s) => s.system.bankHolidays);
  const snapshots = useSelector((s) => s.balanceSnapshots.items);

  useEffect(() => {
    dispatch(ensureDebtConfig());
    dispatch(fetchAccounts());
    dispatch(fetchTransactions());
    dispatch(fetchRecurringBills());
    dispatch(fetchBankHolidays());
    dispatch(fetchBalanceSnapshots());
  }, [dispatch]);

  const startMonth = useMemo(
    () => getForecastStartMonth({ payCycle: profile?.pay_cycle, holidayCache: bankHolidays }),
    [profile, bankHolidays],
  );

  const minOnlyResult = useMemo(
    () => runForecast({ debts, buckets, startMonth, months: HORIZON_MONTHS, minOnly: true }),
    [debts, buckets, startMonth],
  );
  const totalMinPennies = minOnlyResult.months[0]?.minimum_payments_pennies ?? 0;

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

  const baseline = useMemo(
    () => runForecast({
      debts, buckets, startMonth, months: HORIZON_MONTHS,
      monthlyBudget: effectiveBudget, strategy,
    }),
    [debts, buckets, startMonth, effectiveBudget, strategy],
  );

  const metrics = useMemo(
    () => computeProgressMetrics({
      debts, buckets, snapshots, transactions,
      baseline, minOnly: minOnlyResult,
    }),
    [debts, buckets, snapshots, transactions, baseline, minOnlyResult],
  );

  const debtNameById = useMemo(
    () => new Map(debts.map((d) => [d.id, d.name])),
    [debts],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Progress</CardTitle>
        <CardDescription>
          Where you are on the plan under the{' '}
          <span className="font-medium text-foreground">{strategy}</span> strategy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile
            icon={Target}
            label="Debt-free by"
            value={metrics.debtFreeMonth ? formatPayoffMonth(metrics.debtFreeMonth) : 'Beyond horizon'}
            sub={metrics.debtFreeMonth ? formatMonthsDuration(metrics.monthsToPayoff) : null}
          />
          <Tile
            icon={TrendingDown}
            label="Paid off"
            value={metrics.percentPaidOff ? `${Math.round(metrics.percentPaidOff.ratio * 100)}%` : '—'}
            sub={metrics.percentPaidOff
              ? `${formatGBP(metrics.percentPaidOff.paidPennies)} of ${formatGBP(metrics.percentPaidOff.startingPennies)}`
              : 'No starting balances recorded'}
          />
          <Tile
            icon={Receipt}
            label="Interest saved"
            value={formatGBP(metrics.interestSavedPennies)}
            sub="vs minimum-only"
            positive={metrics.interestSavedPennies > 0}
          />
          <Tile
            icon={Flame}
            label="Payment streak"
            value={metrics.paymentStreak > 0 ? `${metrics.paymentStreak} mo` : '—'}
            sub={metrics.paymentStreak > 0 ? 'consecutive months' : 'no debt-tagged payments yet'}
            positive={metrics.paymentStreak > 0}
          />
        </div>

        {variant === 'detail' && metrics.spendingDeltas.size > 0 && (
          <SpendingDeltaList
            deltas={metrics.spendingDeltas}
            debtNameById={debtNameById}
          />
        )}
      </CardContent>
    </Card>
  );
}

function Tile({ icon, label, value, sub, positive = false }) {
  const Icon = icon;
  return (
    <div className="rounded-md border border-border p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wide">
        <Icon className="w-3 h-3" />
        <span>{label}</span>
      </div>
      <div className={`text-lg font-semibold tabular-nums ${positive ? 'text-positive' : 'text-foreground'}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function SpendingDeltaList({ deltas, debtNameById }) {
  const rows = Array.from(deltas.entries()).map(([debtId, delta]) => ({
    debtId,
    name: debtNameById.get(debtId) ?? debtId,
    delta,
  }));
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2">
        Spending delta between last two snapshots
      </div>
      <ul className="divide-y divide-border">
        {rows.map(({ debtId, name, delta }) => (
          <li key={debtId} className="py-2 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{name}</div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {formatGBP(delta.paymentsInPeriodPennies)} paid in the period
              </div>
            </div>
            <SpendingDeltaBadge delta={delta} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SpendingDeltaBadge({ delta }) {
  const nc = delta.newChargesPennies;
  if (nc === 0) {
    return <span className="text-sm text-muted-foreground">Even — no net charges</span>;
  }
  if (nc > 0) {
    return (
      <span className="text-sm text-destructive tabular-nums whitespace-nowrap">
        +{formatGBP(nc)} new charges
      </span>
    );
  }
  return (
    <span className="text-sm text-positive tabular-nums whitespace-nowrap">
      {formatGBP(Math.abs(nc))} cleared beyond payments
    </span>
  );
}
