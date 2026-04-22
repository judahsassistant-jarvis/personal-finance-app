import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { runForecast } from '../../services/debtForecast.js';
import { computeDiscretionary } from '../../services/discretionary.js';
import { STRATEGIES, DEFAULT_PAY_CYCLE, formatGBP } from '../../firebase/schema.js';
import { ensureDebtConfig } from '../../store/debtConfigSlice.js';
import { fetchAccounts } from '../../store/accountsSlice.js';
import { fetchTransactions } from '../../store/transactionsSlice.js';
import { fetchRecurringBills } from '../../store/recurringBillsSlice.js';
import { fetchBankHolidays } from '../../store/systemSlice.js';
import { fetchBalanceSnapshots } from '../../store/balanceSnapshotsSlice.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card.jsx';
import { Button } from '../ui/button.jsx';
import { pickEffectiveBudget, getForecastStartMonth } from './strategyComparisonHelpers.js';
import {
  toProjectedChartData,
  projectedSeries,
  toUtilisationChartData,
  toActualVsProjectedChartData,
  toSavingsChartData,
} from './forecastChartHelpers.js';

const HORIZON_MONTHS = 120; // 10 years — enough for most payoffs to complete

const TABS = [
  { key: 'projected', label: 'Projected' },
  { key: 'utilisation', label: 'Utilisation' },
  { key: 'actual', label: 'Actual vs projected' },
  { key: 'savings', label: 'Interest saved' },
];

export default function ForecastChart({ debts, buckets }) {
  const dispatch = useDispatch();
  const config = useSelector((s) => s.debtConfig.doc);
  const profile = useSelector((s) => s.auth.profile);
  const accounts = useSelector((s) => s.accounts.items);
  const bills = useSelector((s) => s.recurringBills.items);
  const transactions = useSelector((s) => s.transactions.items);
  const bankHolidays = useSelector((s) => s.system.bankHolidays);
  const snapshots = useSelector((s) => s.balanceSnapshots.items);

  const [tab, setTab] = useState('projected');

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

  // Mirror StrategyComparison's effective-budget logic: auto-suggest from
  // discretionary when the toggle is on, otherwise fall back to the saved
  // budget, otherwise the rule-of-thumb heuristic.
  // Min-only baseline — shared across the budget calc and the Savings tab.
  const minOnlyResult = useMemo(
    () => runForecast({ debts, buckets, startMonth, months: HORIZON_MONTHS, minOnly: true }),
    [debts, buckets, startMonth],
  );
  const totalMinPennies = minOnlyResult.months[0]?.minimum_payments_pennies ?? 0;

  const discretionaryCalc = useMemo(() => {
    if (!profile) return null;
    const payCycle = profile.pay_cycle || DEFAULT_PAY_CYCLE;
    return computeDiscretionary({
      accounts, debts, bills, transactions,
      payCycle,
      holidayCache: bankHolidays,
      bufferPennies: Number(profile.buffer_pennies ?? 0),
    });
  }, [profile, accounts, debts, bills, transactions, bankHolidays]);
  const discretionaryPennies = discretionaryCalc?.discretionary_pennies ?? null;

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

  const projectedRows = useMemo(() => toProjectedChartData(forecast.months, debts), [forecast, debts]);
  const seriesSpecs = useMemo(() => projectedSeries(forecast.months, debts), [forecast, debts]);
  const utilisationData = useMemo(() => toUtilisationChartData(forecast.months, debts), [forecast, debts]);
  const actualRows = useMemo(
    () => toActualVsProjectedChartData(forecast.months, debts, snapshots),
    [forecast, debts, snapshots],
  );
  const savingsRows = useMemo(
    () => toSavingsChartData(forecast.months, minOnlyResult.months),
    [forecast, minOnlyResult],
  );

  const hasProjectedData = projectedRows.length > 0 && seriesSpecs.length > 0;
  const hasSnapshots = snapshots.some((s) => debts.some((d) => d.id === s.debt_id));
  const savingsFinalPennies = useMemo(() => {
    const last = savingsRows[savingsRows.length - 1];
    return last ? Math.round(last.savedPounds * 100) : 0;
  }, [savingsRows]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>Forecast</CardTitle>
            <CardDescription>
              {HORIZON_MONTHS / 12}-year projection under the{' '}
              <span className="font-medium text-foreground">{strategy}</span> strategy at{' '}
              <span className="font-medium text-foreground">{formatGBP(effectiveBudget)}</span>/mo.
            </CardDescription>
          </div>
          <div className="flex items-center gap-1 rounded-md bg-muted p-1">
            {TABS.map((t) => (
              <Button
                key={t.key}
                size="sm"
                variant={tab === t.key ? 'default' : 'ghost'}
                onClick={() => setTab(t.key)}
                className="h-7 text-xs"
              >
                {t.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {tab === 'projected' && (
          hasProjectedData ? (
            <ProjectedChart rows={projectedRows} seriesSpecs={seriesSpecs} />
          ) : (
            <EmptyState message="No debts projected — add a debt to see the payoff trajectory." />
          )
        )}
        {tab === 'utilisation' && (
          utilisationData.eligibleDebtCount > 0 ? (
            <UtilisationChart rows={utilisationData.rows} />
          ) : (
            <EmptyState message="No debts with a credit limit set. Utilisation applies to cards, store cards, and overdrafts that have a limit." />
          )
        )}
        {tab === 'actual' && (
          hasProjectedData && hasSnapshots ? (
            <ActualChart rows={actualRows} seriesSpecs={seriesSpecs} />
          ) : (
            <EmptyState message="Record a statement balance on any debt (via the button on its row) and the dots will appear here against the projected line." />
          )
        )}
        {tab === 'savings' && (
          savingsRows.length > 0 ? (
            <SavingsChart rows={savingsRows} finalSavedPennies={savingsFinalPennies} />
          ) : (
            <EmptyState message="No debts to project — add a debt to see cumulative interest saved vs the minimum-only baseline." />
          )
        )}
      </CardContent>
    </Card>
  );
}

function ProjectedChart({ rows, seriesSpecs }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={rows} margin={{ top: 5, right: 15, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis
          dataKey="month"
          stroke="var(--color-muted-foreground)"
          tick={{ fontSize: 11 }}
          minTickGap={20}
        />
        <YAxis
          stroke="var(--color-muted-foreground)"
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => formatYAxisPounds(v)}
          width={60}
        />
        <Tooltip
          formatter={(value) => gbpPoundsToString(Number(value))}
          contentStyle={tooltipStyle}
        />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
        {seriesSpecs.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stroke={s.color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function UtilisationChart({ rows }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={rows} margin={{ top: 5, right: 15, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis
          dataKey="month"
          stroke="var(--color-muted-foreground)"
          tick={{ fontSize: 11 }}
          minTickGap={20}
        />
        <YAxis
          stroke="var(--color-muted-foreground)"
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => `${v}%`}
          domain={[0, (dataMax) => Math.max(100, Math.ceil(dataMax / 10) * 10)]}
          width={50}
        />
        <Tooltip
          formatter={(value) => `${Number(value).toFixed(1)}%`}
          contentStyle={tooltipStyle}
        />
        <ReferenceLine y={75} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'High 75%', fontSize: 10, fill: '#ef4444', position: 'right' }} />
        <ReferenceLine y={30} stroke="#10b981" strokeDasharray="3 3" label={{ value: 'Good 30%', fontSize: 10, fill: '#10b981', position: 'right' }} />
        <Line
          type="monotone"
          dataKey="utilisation"
          stroke="#0ea5e9"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ActualChart({ rows, seriesSpecs }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-2">
        Solid = recorded statement balances. Dashed = projected from the latest balance forward.
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={rows} margin={{ top: 5, right: 15, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="month"
            stroke="var(--color-muted-foreground)"
            tick={{ fontSize: 11 }}
            minTickGap={20}
          />
          <YAxis
            stroke="var(--color-muted-foreground)"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => formatYAxisPounds(v)}
            width={60}
          />
          <Tooltip
            formatter={(value, name) => [
              gbpPoundsToString(Number(value)),
              typeof name === 'string' && name.endsWith('_projected')
                ? `${name.replace(/_projected$/, '')} (projected)`
                : typeof name === 'string' && name.endsWith('_actual')
                  ? `${name.replace(/_actual$/, '')} (actual)`
                  : name,
            ]}
            contentStyle={tooltipStyle}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(value) =>
              typeof value === 'string' ? value.replace(/_actual$/, '') : value
            }
          />
          {seriesSpecs.map((s) => (
            <Line
              key={`${s.key}_actual`}
              type="monotone"
              dataKey={`${s.key}_actual`}
              stroke={s.color}
              strokeWidth={2}
              dot={{ r: 3, fill: s.color, stroke: s.color }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
          {seriesSpecs.map((s) => (
            <Line
              key={`${s.key}_projected`}
              type="monotone"
              dataKey={`${s.key}_projected`}
              stroke={s.color}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              connectNulls
              isAnimationActive={false}
              legendType="none"
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function SavingsChart({ rows, finalSavedPennies }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-2">
        Running total of interest avoided by following the active plan instead of minimums only.
        {finalSavedPennies > 0 && (
          <>
            {' '}End of horizon:{' '}
            <span className="text-positive font-medium tabular-nums">
              £{(finalSavedPennies / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })}
            </span>
            {' '}saved.
          </>
        )}
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={rows} margin={{ top: 5, right: 15, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="month"
            stroke="var(--color-muted-foreground)"
            tick={{ fontSize: 11 }}
            minTickGap={20}
          />
          <YAxis
            stroke="var(--color-muted-foreground)"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => formatYAxisPounds(v)}
            width={60}
          />
          <Tooltip
            formatter={(value) => [gbpPoundsToString(Number(value)), 'Interest saved']}
            contentStyle={tooltipStyle}
          />
          <Line
            type="monotone"
            dataKey="savedPounds"
            stroke="var(--color-positive)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="h-[300px] flex items-center justify-center text-sm text-muted-foreground text-center px-6">
      {message}
    </div>
  );
}

const tooltipStyle = {
  background: 'var(--color-card)',
  border: '1px solid var(--color-border)',
  borderRadius: '6px',
  fontSize: 12,
};

function formatYAxisPounds(v) {
  if (v >= 1000) return `£${Math.round(v / 1000)}k`;
  return `£${Math.round(v)}`;
}

function gbpPoundsToString(pounds) {
  const pennies = Math.round(pounds * 100);
  return formatGBP(pennies);
}
