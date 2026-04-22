import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Flame, Snowflake, Sparkles, Minus, Trophy } from 'lucide-react';
import { runForecast } from '../../services/debtForecast.js';
import { STRATEGIES, formatGBP } from '../../firebase/schema.js';
import { ensureDebtConfig, updateDebtConfig } from '../../store/debtConfigSlice.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card.jsx';
import { Button } from '../ui/button.jsx';
import { Badge } from '../ui/badge.jsx';
import { Input } from '../ui/input.jsx';
import {
  summarisePlan,
  suggestBudgetPennies,
  formatMonthsDuration,
  formatPayoffMonth,
  pickWinnerStrategy,
} from './strategyComparisonHelpers.js';

const STRATEGY_META = {
  [STRATEGIES.AVALANCHE]: { label: 'Avalanche', icon: Flame },
  [STRATEGIES.SNOWBALL]: { label: 'Snowball', icon: Snowflake },
  [STRATEGIES.HYBRID]: { label: 'Hybrid', icon: Sparkles },
};

const FORECAST_HORIZON_MONTHS = 360;

export default function StrategyComparison({ debts, buckets }) {
  const dispatch = useDispatch();
  const config = useSelector((s) => s.debtConfig.doc);

  useEffect(() => {
    dispatch(ensureDebtConfig());
  }, [dispatch]);

  const startMonth = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  }, []);

  const minOnlyResult = useMemo(
    () => runForecast({
      debts,
      buckets,
      startMonth,
      months: FORECAST_HORIZON_MONTHS,
      minOnly: true,
    }),
    [debts, buckets, startMonth],
  );

  const totalMinPennies = useMemo(() => {
    const firstRow = minOnlyResult.months[0];
    return firstRow ? firstRow.minimum_payments_pennies : 0;
  }, [minOnlyResult]);

  const savedBudget = config?.monthly_budget_pennies ?? null;
  const suggestedBudget = useMemo(
    () => suggestBudgetPennies(totalMinPennies),
    [totalMinPennies],
  );
  const effectiveBudget = savedBudget ?? suggestedBudget;

  const [draftBudget, setDraftBudget] = useState(() => penniesToPounds(effectiveBudget));
  useEffect(() => {
    setDraftBudget(penniesToPounds(effectiveBudget));
  }, [effectiveBudget]);

  const strategies = useMemo(() => {
    const common = { debts, buckets, startMonth, months: FORECAST_HORIZON_MONTHS, monthlyBudget: effectiveBudget };
    return {
      avalanche: runForecast({ ...common, strategy: STRATEGIES.AVALANCHE }),
      snowball: runForecast({ ...common, strategy: STRATEGIES.SNOWBALL }),
      hybrid: runForecast({ ...common, strategy: STRATEGIES.HYBRID }),
    };
  }, [debts, buckets, startMonth, effectiveBudget]);

  const winner = useMemo(() => pickWinnerStrategy(strategies), [strategies]);
  const baselinePlan = useMemo(() => summarisePlan(minOnlyResult), [minOnlyResult]);

  const budgetExceedsMinimums = effectiveBudget > totalMinPennies;

  const handleBudgetSave = async () => {
    const pennies = parseBudgetInput(draftBudget);
    if (pennies === null) return;
    if (!config) return;
    if (pennies === savedBudget) return;
    await dispatch(updateDebtConfig({ id: config.id, monthly_budget_pennies: pennies })).unwrap();
  };

  const handleSelectStrategy = async (strategy) => {
    if (!config || config.strategy === strategy) return;
    await dispatch(updateDebtConfig({ id: config.id, strategy })).unwrap();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Strategy comparison</CardTitle>
        <CardDescription>
          How each strategy performs at your monthly budget, against a minimum-only baseline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-48">
            <label htmlFor="strategy-budget-input" className="text-xs text-muted-foreground">
              Monthly budget
            </label>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-muted-foreground">£</span>
              <Input
                id="strategy-budget-input"
                type="number"
                inputMode="decimal"
                step="1"
                min="0"
                value={draftBudget}
                onChange={(e) => setDraftBudget(e.target.value)}
                onBlur={handleBudgetSave}
                className="max-w-32"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleBudgetSave}
                disabled={!config || parseBudgetInput(draftBudget) === savedBudget}
                className="h-9"
              >
                Save
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Total minimums: {formatGBP(totalMinPennies)}/mo
              {savedBudget == null && ' · suggested above covers minimums + 50% headroom'}
            </p>
          </div>
        </div>

        {!budgetExceedsMinimums && (
          <div className="rounded-md border border-warning bg-warning/10 p-3 text-sm text-foreground">
            Your budget doesn&apos;t exceed the minimum payments, so every strategy produces the same result.
            Try a higher number above to see where each strategy diverges.
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground uppercase tracking-wide">
              <tr>
                <th className="text-left py-2 pr-3 font-medium">Strategy</th>
                <th className="text-left py-2 pr-3 font-medium">Payoff</th>
                <th className="text-right py-2 pr-3 font-medium">Total interest</th>
                <th className="text-left py-2 pr-3 font-medium">vs baseline</th>
                <th className="text-right py-2 font-medium">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              <ComparisonRow
                label="Minimum only"
                icon={Minus}
                plan={baselinePlan}
                baseline={baselinePlan}
                isBaseline
              />
              {Object.entries(strategies).map(([key, result]) => {
                const plan = summarisePlan(result);
                const meta = STRATEGY_META[key];
                const isWinner = winner === key && budgetExceedsMinimums;
                const isActive = config?.strategy === key;
                return (
                  <ComparisonRow
                    key={key}
                    label={meta.label}
                    icon={meta.icon}
                    plan={plan}
                    baseline={baselinePlan}
                    isWinner={isWinner}
                    isActive={isActive}
                    onSelect={() => handleSelectStrategy(key)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ComparisonRow({ label, icon, plan, baseline, isBaseline = false, isWinner = false, isActive = false, onSelect }) {
  const Icon = icon;
  const interestSaved = baseline.totalInterestPennies - plan.totalInterestPennies;
  const monthsSaved = baseline.monthsToPayoff - plan.monthsToPayoff;

  return (
    <tr className={`border-t border-border ${isWinner ? 'bg-positive/5' : ''}`}>
      <td className="py-2.5 pr-3">
        <div className="flex items-center gap-2">
          <Icon className={`w-3.5 h-3.5 ${isBaseline ? 'text-muted-foreground' : ''}`} />
          <span className={isBaseline ? 'text-muted-foreground' : 'font-medium'}>{label}</span>
          {isWinner && <Trophy className="w-3 h-3 text-positive" />}
          {isActive && <Badge variant="muted" className="text-xs">active</Badge>}
        </div>
      </td>
      <td className="py-2.5 pr-3 tabular-nums">
        <div>{formatMonthsDuration(plan.monthsToPayoff)}</div>
        {plan.debtFreeMonth && (
          <div className="text-xs text-muted-foreground">{formatPayoffMonth(plan.debtFreeMonth)}</div>
        )}
      </td>
      <td className="py-2.5 pr-3 text-right tabular-nums font-mono">
        {formatGBP(plan.totalInterestPennies)}
      </td>
      <td className="py-2.5 pr-3">
        {isBaseline ? (
          <span className="text-xs text-muted-foreground">— baseline —</span>
        ) : interestSaved > 0 ? (
          <div className="text-xs">
            <span className="text-positive font-medium">saves {formatGBP(interestSaved)}</span>
            {monthsSaved > 0 && (
              <span className="text-muted-foreground"> · {formatMonthsDuration(monthsSaved)} faster</span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">no saving vs baseline</span>
        )}
      </td>
      <td className="py-2.5 text-right">
        {!isBaseline && (
          <Button
            size="sm"
            variant={isActive ? 'ghost' : 'outline'}
            disabled={isActive}
            onClick={onSelect}
            className="h-7 text-xs"
          >
            {isActive ? 'Active' : 'Use this'}
          </Button>
        )}
      </td>
    </tr>
  );
}

function penniesToPounds(pennies) {
  if (pennies == null) return '';
  return String(Math.round(pennies / 100));
}

function parseBudgetInput(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
