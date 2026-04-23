import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { fetchAccounts } from '../store/accountsSlice.js';
import { updateProfile } from '../store/authSlice.js';
import { Input } from '../components/ui/input.jsx';
import {
  ACCOUNT_SUBTYPES,
  LIQUIDITY,
  formatGBP,
} from '../firebase/schema.js';
import { runAccountForecast, computeHorizonMonths } from '../services/accountForecast.js';
import {
  toAccountChartData,
  accountSeriesSpecs,
} from '../components/forecast/forecastPageHelpers.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card.jsx';
import { Button } from '../components/ui/button.jsx';
import { cn } from '../lib/utils.js';

const HORIZON_OPTIONS = [
  { key: '12', label: '12 months', months: 12 },
  { key: '60', label: '5 years', months: 60 },
  { key: '120', label: '10 years', months: 120 },
  { key: 'sipp', label: 'Until SIPP age', months: null }, // computed at render
];

const SUBTYPE_LABELS = {
  [ACCOUNT_SUBTYPES.CURRENT]: 'Current',
  [ACCOUNT_SUBTYPES.SAVINGS]: 'Savings',
  [ACCOUNT_SUBTYPES.CASH_ISA]: 'Cash ISA',
  [ACCOUNT_SUBTYPES.SS_ISA]: 'S&S ISA',
  [ACCOUNT_SUBTYPES.SIPP]: 'SIPP',
  [ACCOUNT_SUBTYPES.INVESTMENT]: 'Investment',
  [ACCOUNT_SUBTYPES.PENSION]: 'Pension',
};

export default function Forecast() {
  const dispatch = useDispatch();
  const accounts = useSelector((s) => s.accounts.items);
  const accountsLoading = useSelector((s) => s.accounts.loading);
  const profile = useSelector((s) => s.auth.profile);

  const [horizonKey, setHorizonKey] = useState('12');
  const [visibleIds, setVisibleIds] = useState(null); // null = all
  const [view, setView] = useState('per-account'); // 'per-account' | 'net-worth'
  const [scenarioAmount, setScenarioAmount] = useState(''); // pounds per month string
  const [scenarioTargetId, setScenarioTargetId] = useState('');

  useEffect(() => {
    dispatch(fetchAccounts());
  }, [dispatch]);

  // On first non-empty accounts load, default to all visible.
  useEffect(() => {
    if (accounts.length > 0 && visibleIds === null) {
      setVisibleIds(accounts.map((a) => a.id));
    }
  }, [accounts, visibleIds]);

  const sippAccounts = useMemo(
    () => accounts.filter((a) => a.subtype === ACCOUNT_SUBTYPES.SIPP),
    [accounts],
  );
  const sippHorizon = useMemo(
    () => computeHorizonMonths({
      defaultMonths: 12,
      sippAccounts,
      birthYear: profile?.birth_year,
    }),
    [sippAccounts, profile?.birth_year],
  );

  const horizonMonths = useMemo(() => {
    if (horizonKey === 'sipp') return sippHorizon;
    const opt = HORIZON_OPTIONS.find((o) => o.key === horizonKey);
    return opt?.months ?? 12;
  }, [horizonKey, sippHorizon]);

  const sippHorizonAvailable = sippAccounts.length > 0 && profile?.birth_year && sippHorizon > 12;

  const forecast = useMemo(
    () => runAccountForecast({ accounts, months: horizonMonths }),
    [accounts, horizonMonths],
  );

  // Default scenario target to the first SIPP, else the first non-current, else first account.
  useEffect(() => {
    if (accounts.length === 0 || scenarioTargetId) return;
    const sipp = accounts.find((a) => a.subtype === ACCOUNT_SUBTYPES.SIPP);
    const nonCurrent = accounts.find((a) => a.subtype !== ACCOUNT_SUBTYPES.CURRENT);
    setScenarioTargetId((sipp ?? nonCurrent ?? accounts[0]).id);
  }, [accounts, scenarioTargetId]);

  const scenarioExtraPennies = useMemo(() => {
    const n = Number(scenarioAmount);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100);
  }, [scenarioAmount]);
  const scenarioActive = scenarioExtraPennies > 0 && !!scenarioTargetId;

  const scenarioForecast = useMemo(() => {
    if (!scenarioActive) return null;
    return runAccountForecast({
      accounts,
      months: horizonMonths,
      scenario: { extraContributionPennies: scenarioExtraPennies, accountIds: [scenarioTargetId] },
    });
  }, [scenarioActive, accounts, horizonMonths, scenarioExtraPennies, scenarioTargetId]);

  const visibleIdSet = visibleIds ?? accounts.map((a) => a.id);
  const chartRows = useMemo(
    () => toAccountChartData(forecast.rows, accounts, visibleIdSet),
    [forecast, accounts, visibleIdSet],
  );
  const scenarioChartRows = useMemo(
    () => (scenarioForecast ? toAccountChartData(scenarioForecast.rows, accounts, visibleIdSet) : null),
    [scenarioForecast, accounts, visibleIdSet],
  );
  // Merge the scenario total + target-account balance onto the baseline rows so
  // both lines share an x-axis. Baseline rows are untouched when scenario is off.
  const mergedChartRows = useMemo(() => {
    if (!scenarioChartRows) return chartRows;
    const targetName = accounts.find((a) => a.id === scenarioTargetId)?.name;
    return chartRows.map((r, i) => {
      const s = scenarioChartRows[i];
      const out = { ...r, total_scenario: s?.total };
      if (targetName && s && s[targetName] != null) {
        out[`${targetName} (with extra)`] = s[targetName];
      }
      return out;
    });
  }, [chartRows, scenarioChartRows, accounts, scenarioTargetId]);
  const series = useMemo(
    () => accountSeriesSpecs(accounts, visibleIdSet),
    [accounts, visibleIdSet],
  );

  const finalRow = chartRows[chartRows.length - 1];
  const finalTotalPennies = finalRow ? Math.round(finalRow.total * 100) : 0;
  const startTotalPennies = accounts
    .filter((a) => visibleIdSet.includes(a.id))
    .reduce((s, a) => s + Number(a.balance_pennies ?? 0), 0);
  const deltaPennies = finalTotalPennies - startTotalPennies;

  const scenarioFinalTotalPennies = scenarioChartRows
    ? Math.round((scenarioChartRows[scenarioChartRows.length - 1]?.total ?? 0) * 100)
    : null;
  const scenarioDeltaVsBaseline = scenarioFinalTotalPennies != null
    ? scenarioFinalTotalPennies - finalTotalPennies
    : null;

  function toggleAccount(id) {
    const current = visibleIdSet;
    setVisibleIds(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  }

  if (accountsLoading && accounts.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">Loading accounts…</div>
    );
  }

  if (accounts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Forecast</CardTitle>
          <CardDescription>No accounts yet. Add one from the Accounts page to see a projection.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>Forecast</CardTitle>
              <CardDescription>
                Where your accounts are heading over the next{' '}
                <span className="font-medium text-foreground">{labelForHorizon(horizonMonths)}</span>.
              </CardDescription>
            </div>
            <HorizonTabs
              activeKey={horizonKey}
              onChange={setHorizonKey}
              sippHorizonAvailable={sippHorizonAvailable}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {sippAccounts.length > 0 && !profile?.birth_year && (
            <BirthYearPrompt />
          )}
          <AccountSelector accounts={accounts} visibleIdSet={visibleIdSet} onToggle={toggleAccount} />
          <ViewTabs activeKey={view} onChange={setView} />
          {series.length > 0 ? (
            view === 'per-account'
              ? <PerAccountChart
                  rows={mergedChartRows}
                  series={series}
                  scenarioActive={scenarioActive}
                  scenarioTargetName={accounts.find((a) => a.id === scenarioTargetId)?.name}
                />
              : <NetWorthChart
                  rows={mergedChartRows}
                  scenarioActive={scenarioActive}
                />
          ) : (
            <div className="h-[300px] flex items-center justify-center text-sm text-muted-foreground">
              Select at least one account above to see a projection.
            </div>
          )}
          <SummaryTiles
            startPennies={startTotalPennies}
            endPennies={finalTotalPennies}
            deltaPennies={deltaPennies}
            horizonLabel={labelForHorizon(horizonMonths)}
            scenarioEndPennies={scenarioFinalTotalPennies}
            scenarioDelta={scenarioDeltaVsBaseline}
          />
        </CardContent>
      </Card>

      <ScenarioCard
        accounts={accounts}
        amount={scenarioAmount}
        setAmount={setScenarioAmount}
        targetId={scenarioTargetId}
        setTargetId={setScenarioTargetId}
        scenarioActive={scenarioActive}
        scenarioDelta={scenarioDeltaVsBaseline}
        horizonLabel={labelForHorizon(horizonMonths)}
      />
    </div>
  );
}

function labelForHorizon(months) {
  if (months < 12) return `${months} months`;
  if (months % 12 === 0) {
    const y = months / 12;
    return y === 1 ? '1 year' : `${y} years`;
  }
  return `${months} months`;
}

function HorizonTabs({ activeKey, onChange, sippHorizonAvailable }) {
  return (
    <div className="flex items-center gap-1 rounded-md bg-muted p-1">
      {HORIZON_OPTIONS.map((opt) => {
        if (opt.key === 'sipp' && !sippHorizonAvailable) return null;
        return (
          <Button
            key={opt.key}
            size="sm"
            variant={activeKey === opt.key ? 'default' : 'ghost'}
            onClick={() => onChange(opt.key)}
            className="h-7 text-xs"
          >
            {opt.label}
          </Button>
        );
      })}
    </div>
  );
}

function AccountSelector({ accounts, visibleIdSet, onToggle }) {
  const visible = new Set(visibleIdSet);
  return (
    <div className="flex flex-wrap gap-2">
      {accounts.map((a) => {
        const on = visible.has(a.id);
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onToggle(a.id)}
            className={cn(
              'px-3 py-1.5 rounded-full border text-xs font-medium transition-colors',
              on
                ? 'bg-secondary text-secondary-foreground border-transparent'
                : 'bg-background text-muted-foreground border-border hover:border-foreground/20',
            )}
            aria-pressed={on}
          >
            <span className="mr-2">{a.name}</span>
            <span className="text-[10px] opacity-60 uppercase tracking-wide">
              {SUBTYPE_LABELS[a.subtype] ?? a.subtype}
            </span>
            {a.liquidity === LIQUIDITY.LOCKED && (
              <span className="ml-1 text-[10px] opacity-60">· locked</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ViewTabs({ activeKey, onChange }) {
  const options = [
    { key: 'per-account', label: 'Per account' },
    { key: 'net-worth', label: 'Net worth' },
  ];
  return (
    <div className="inline-flex items-center gap-1 rounded-md bg-muted p-1 self-start">
      {options.map((o) => (
        <Button
          key={o.key}
          size="sm"
          variant={activeKey === o.key ? 'default' : 'ghost'}
          onClick={() => onChange(o.key)}
          className="h-7 text-xs"
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

function NetWorthChart({ rows, scenarioActive }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={rows} margin={{ top: 5, right: 15, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <defs>
          <linearGradient id="nw-liquid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.5} />
            <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="nw-locked" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.5} />
            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="month"
          stroke="var(--color-muted-foreground)"
          tick={{ fontSize: 11 }}
          minTickGap={20}
        />
        <YAxis
          stroke="var(--color-muted-foreground)"
          tick={{ fontSize: 11 }}
          tickFormatter={formatYAxisPounds}
          width={60}
        />
        <Tooltip
          formatter={(value, name) => [gbpPoundsToString(Number(value)), labelForAreaKey(name)]}
          contentStyle={TOOLTIP_STYLE}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={labelForAreaKey}
        />
        <Area
          type="monotone"
          dataKey="liquid"
          stackId="nw"
          stroke="#0ea5e9"
          fill="url(#nw-liquid)"
          strokeWidth={1.5}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="locked"
          stackId="nw"
          stroke="#8b5cf6"
          fill="url(#nw-locked)"
          strokeWidth={1.5}
          isAnimationActive={false}
        />
        {scenarioActive && (
          <Line
            type="monotone"
            dataKey="total_scenario"
            stroke="#10b981"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive={false}
            legendType="plainline"
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

function labelForAreaKey(key) {
  if (key === 'liquid') return 'Liquid (spendable)';
  if (key === 'locked') return 'Locked (SIPP / ISA / investments)';
  if (key === 'total_scenario') return 'With extra contribution';
  return key;
}

function PerAccountChart({ rows, series, scenarioActive, scenarioTargetName }) {
  const scenarioKey = scenarioActive && scenarioTargetName
    ? `${scenarioTargetName} (with extra)`
    : null;
  return (
    <ResponsiveContainer width="100%" height={320}>
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
          tickFormatter={formatYAxisPounds}
          width={60}
        />
        <Tooltip
          formatter={(value) => gbpPoundsToString(Number(value))}
          contentStyle={TOOLTIP_STYLE}
        />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
        {series.map((s) => (
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
        {scenarioKey && (
          <Line
            key={scenarioKey}
            type="monotone"
            dataKey={scenarioKey}
            stroke="#10b981"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive={false}
            legendType="plainline"
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

function SummaryTiles({ startPennies, endPennies, deltaPennies, horizonLabel, scenarioEndPennies, scenarioDelta }) {
  const sign = deltaPennies >= 0 ? '+' : '';
  const deltaClass = deltaPennies >= 0 ? 'text-positive' : 'text-destructive';
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Tile label="Today" value={formatGBP(startPennies)} />
      <Tile label={`In ${horizonLabel}`} value={formatGBP(endPennies)} />
      {scenarioEndPennies != null ? (
        <Tile
          label={`With extra in ${horizonLabel}`}
          value={
            <span className="text-positive">
              {formatGBP(scenarioEndPennies)}
              <span className="block text-xs font-normal text-muted-foreground mt-0.5">
                +{formatGBP(Math.max(0, scenarioDelta ?? 0))} vs baseline
              </span>
            </span>
          }
        />
      ) : (
        <Tile
          label="Change"
          value={<span className={deltaClass}>{sign}{formatGBP(Math.abs(deltaPennies))}</span>}
        />
      )}
    </div>
  );
}

function ScenarioCard({
  accounts, amount, setAmount, targetId, setTargetId,
  scenarioActive, scenarioDelta, horizonLabel,
}) {
  const FIELD = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  // Prefer accounts that are savings/investment/pension as scenario targets
  // (putting extra into a current account doesn't compound meaningfully).
  const targetableAccounts = accounts.filter((a) => a.subtype !== ACCOUNT_SUBTYPES.CURRENT);

  if (targetableAccounts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>What if I contributed more?</CardTitle>
          <CardDescription>
            Add a savings, ISA, or pension account to model extra contributions.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>What if I contributed more?</CardTitle>
        <CardDescription>
          Add an extra monthly contribution to a single account and see the effect.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="scn-amount" className="text-sm font-medium">Extra per month (£)</label>
            <Input
              id="scn-amount"
              type="number"
              step="0.01"
              min={0}
              placeholder="e.g. 100"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="scn-target" className="text-sm font-medium">Into which account</label>
            <select
              id="scn-target"
              className={FIELD}
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            >
              {targetableAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({SUBTYPE_LABELS[a.subtype] ?? a.subtype})
                </option>
              ))}
            </select>
          </div>
        </div>
        {scenarioActive && (
          <div className="rounded-md border border-border bg-positive/10 px-3 py-2 text-sm">
            <span className="font-medium">Over {horizonLabel}: </span>
            <span className="text-positive font-semibold">
              +{formatGBP(Math.max(0, scenarioDelta ?? 0))}
            </span>
            <span className="text-muted-foreground"> more than baseline.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BirthYearPrompt() {
  const dispatch = useDispatch();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    const year = Number(value);
    const thisYear = new Date().getFullYear();
    if (!Number.isInteger(year) || year < 1900 || year > thisYear) {
      setError('Enter a 4-digit year');
      return;
    }
    try {
      setSaving(true);
      await dispatch(updateProfile({ birth_year: year })).unwrap();
      setError(null);
    } catch (e) {
      setError(e.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-muted/40 p-3 flex items-center gap-3 flex-wrap">
      <div className="text-sm flex-1 min-w-[220px]">
        <span className="font-medium">Tell us your birth year</span>{' '}
        <span className="text-muted-foreground">
          to project your SIPP out to the qualifying age.
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          placeholder="e.g. 1982"
          min={1900}
          max={new Date().getFullYear()}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-32 h-8"
        />
        <Button size="sm" variant="accent" onClick={save} disabled={saving || !value}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {error && <div className="text-xs text-destructive w-full">{error}</div>}
    </div>
  );
}

function Tile({ label, value }) {
  return (
    <div className="rounded-md border border-border bg-background px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

const TOOLTIP_STYLE = {
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
  return formatGBP(Math.round(pounds * 100));
}
