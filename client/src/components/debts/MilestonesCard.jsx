import { useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Flag, Gauge, PartyPopper } from 'lucide-react';
import { runForecast } from '../../services/debtForecast.js';
import { computeDiscretionary } from '../../services/discretionary.js';
import { STRATEGIES, DEFAULT_PAY_CYCLE, formatGBP } from '../../firebase/schema.js';
import { ensureDebtConfig } from '../../store/debtConfigSlice.js';
import { fetchAccounts } from '../../store/accountsSlice.js';
import { fetchTransactions } from '../../store/transactionsSlice.js';
import { fetchRecurringBills } from '../../store/recurringBillsSlice.js';
import { fetchBankHolidays } from '../../store/systemSlice.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card.jsx';
import { Separator } from '../ui/separator.jsx';
import { pickEffectiveBudget, formatPayoffMonth } from './strategyComparisonHelpers.js';
import { computeMilestones } from './milestonesHelpers.js';

const HORIZON_MONTHS = 360; // 30 years — long enough for any realistic payoff

export default function MilestonesCard({ debts, buckets }) {
  const dispatch = useDispatch();
  const config = useSelector((s) => s.debtConfig.doc);
  const profile = useSelector((s) => s.auth.profile);
  const accounts = useSelector((s) => s.accounts.items);
  const bills = useSelector((s) => s.recurringBills.items);
  const transactions = useSelector((s) => s.transactions.items);
  const bankHolidays = useSelector((s) => s.system.bankHolidays);

  useEffect(() => {
    dispatch(ensureDebtConfig());
    dispatch(fetchAccounts());
    dispatch(fetchTransactions());
    dispatch(fetchRecurringBills());
    dispatch(fetchBankHolidays());
  }, [dispatch]);

  const startMonth = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  }, []);

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

  const forecast = useMemo(
    () => runForecast({
      debts, buckets, startMonth, months: HORIZON_MONTHS,
      monthlyBudget: effectiveBudget,
      strategy,
    }),
    [debts, buckets, startMonth, effectiveBudget, strategy],
  );

  const milestones = useMemo(() => computeMilestones(forecast, debts), [forecast, debts]);

  const hasAnyMilestones =
    milestones.perCategory.length > 0 ||
    milestones.perDebt.length > 0 ||
    milestones.utilisationCrossings.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Milestones</CardTitle>
        <CardDescription>
          Dates your payoff plan hits meaningful checkpoints under the current strategy and budget.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!hasAnyMilestones && (
          <p className="text-sm text-muted-foreground">
            No milestones in the projection yet — the current budget doesn&apos;t clear any debt
            within the forecast horizon. Try raising the monthly budget.
          </p>
        )}

        {milestones.debtFreeMonth && (
          <DebtFreeHero month={milestones.debtFreeMonth} />
        )}

        {milestones.perCategory.length > 0 && (
          <Section title="Category payoffs" icon={Flag}>
            {milestones.perCategory.map((c) => (
              <MilestoneRow
                key={c.subtype}
                primary={`All ${c.label} cleared`}
                secondary={`${c.count} debt${c.count === 1 ? '' : 's'} in this category`}
                date={formatPayoffMonth(c.lastPayoffMonth)}
              />
            ))}
          </Section>
        )}

        {milestones.perDebt.length > 0 && (
          <Section title="Per-debt payoffs" icon={Flag}>
            {milestones.perDebt.map((p) => (
              <MilestoneRow
                key={p.debtId}
                primary={p.name}
                secondary={
                  p.totalInterestPennies > 0
                    ? `${formatGBP(p.totalInterestPennies)} total interest`
                    : null
                }
                date={formatPayoffMonth(p.payoffMonth)}
              />
            ))}
          </Section>
        )}

        {milestones.utilisationCrossings.length > 0 && (
          <Section title="Utilisation milestones" icon={Gauge}>
            {milestones.utilisationCrossings.map((c) => (
              <MilestoneRow
                key={c.threshold}
                primary={utilisationRowLabel(c.threshold)}
                secondary={utilisationRowSecondary(c.threshold)}
                date={formatPayoffMonth(c.month)}
              />
            ))}
          </Section>
        )}
      </CardContent>
    </Card>
  );
}

function DebtFreeHero({ month }) {
  return (
    <div className="rounded-md border border-positive bg-positive/5 p-3 flex items-center gap-3">
      <PartyPopper className="w-5 h-5 text-positive shrink-0" />
      <div>
        <div className="text-sm font-medium">Debt-free by {formatPayoffMonth(month)}</div>
        <div className="text-xs text-muted-foreground">
          Every debt tracked here is cleared by this date under the current plan.
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon, children }) {
  const Icon = icon;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground uppercase tracking-wide">
        <Icon className="w-3.5 h-3.5" />
        <span>{title}</span>
      </div>
      <div>
        {children}
      </div>
    </div>
  );
}

function MilestoneRow({ primary, secondary, date }) {
  return (
    <>
      <div className="flex items-start justify-between gap-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{primary}</div>
          {secondary && (
            <div className="text-xs text-muted-foreground">{secondary}</div>
          )}
        </div>
        <div className="text-sm tabular-nums text-muted-foreground whitespace-nowrap">
          {date}
        </div>
      </div>
      <Separator />
    </>
  );
}

function utilisationRowLabel(threshold) {
  if (threshold === 0) return 'All limited balances cleared (0% utilisation)';
  return `Utilisation drops below ${Math.round(threshold * 100)}%`;
}

function utilisationRowSecondary(threshold) {
  if (threshold === 0) return 'Every card and overdraft fully paid off';
  if (threshold <= 0.30) return 'Credit-score "low utilisation" band';
  if (threshold <= 0.50) return 'Moving out of the "high" band';
  return 'First major utilisation improvement';
}
