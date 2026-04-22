import { useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Flame, Snowflake, Sparkles } from 'lucide-react';
import { ensureDebtConfig, updateDebtConfig } from '../../store/debtConfigSlice.js';
import { STRATEGIES, formatGBP } from '../../firebase/schema.js';
import { rankForStrategy } from './strategyHelpers.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card.jsx';
import { Button } from '../ui/button.jsx';

const STRATEGY_COPY = {
  [STRATEGIES.AVALANCHE]: {
    label: 'Avalanche',
    icon: Flame,
    blurb: 'Highest-APR debt first. Minimises total interest over the payoff.',
    rankCaption: 'Extra payments target (highest APR first):',
  },
  [STRATEGIES.SNOWBALL]: {
    label: 'Snowball',
    icon: Snowflake,
    blurb: 'Smallest balance first. Each payoff frees up its minimum for the next debt.',
    rankCaption: 'Extra payments target (smallest balance first):',
  },
  [STRATEGIES.HYBRID]: {
    label: 'Hybrid',
    icon: Sparkles,
    blurb: 'Highest APR first, but debts under £500 get bumped up for quick wins.',
    rankCaption: 'Extra payments target (small wins, then highest APR):',
  },
};

export default function StrategyCard({ rows }) {
  const dispatch = useDispatch();
  const config = useSelector((s) => s.debtConfig.doc);

  useEffect(() => {
    dispatch(ensureDebtConfig());
  }, [dispatch]);

  const strategy = config?.strategy ?? STRATEGIES.AVALANCHE;

  const { ranked, bnplCount, zeroBalanceCount } = useMemo(
    () => rankForStrategy(rows, strategy),
    [rows, strategy],
  );

  const handleStrategyChange = (next) => {
    if (!config || config.strategy === next) return;
    dispatch(updateDebtConfig({ id: config.id, strategy: next }));
  };

  const copy = STRATEGY_COPY[strategy] ?? STRATEGY_COPY[STRATEGIES.AVALANCHE];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle>Strategy</CardTitle>
            <CardDescription>{copy.blurb}</CardDescription>
          </div>
          <div className="flex items-center gap-1 rounded-md bg-muted p-1">
            {Object.values(STRATEGIES).map((s) => {
              const active = s === strategy;
              const Icon = STRATEGY_COPY[s].icon;
              return (
                <Button
                  key={s}
                  size="sm"
                  variant={active ? 'default' : 'ghost'}
                  onClick={() => handleStrategyChange(s)}
                  disabled={!config}
                  className="h-7"
                >
                  <Icon className="w-3.5 h-3.5" />
                  {STRATEGY_COPY[s].label}
                </Button>
              );
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {ranked.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No debts eligible for extra payment allocation yet.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2">{copy.rankCaption}</p>
            <ol className="space-y-1.5">
              {ranked.map((row, i) => (
                <RankRow key={row.debt.id} rank={i + 1} row={row} strategy={strategy} />
              ))}
            </ol>
          </>
        )}
        {(bnplCount > 0 || zeroBalanceCount > 0) && (
          <p className="mt-3 text-xs text-muted-foreground">
            {bnplCount > 0 && <>BNPL ({bnplCount}) run on fixed schedules — no extra allocation. </>}
            {zeroBalanceCount > 0 && <>{zeroBalanceCount} zero-balance debt{zeroBalanceCount === 1 ? '' : 's'} excluded.</>}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function RankRow({ rank, row, strategy }) {
  const { debt, totalBalance, blendedApr } = row;
  const aprLabel = blendedApr > 0 ? `${(blendedApr * 100).toFixed(1)}% APR` : '—';
  const secondary = strategy === STRATEGIES.SNOWBALL
    ? formatGBP(totalBalance)
    : aprLabel;
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="font-mono text-xs text-muted-foreground w-5 text-right">{rank}</span>
        <span className="truncate">{debt.name}</span>
        {debt.priority && <span className="text-xs text-warning-foreground">priority</span>}
      </div>
      <span className="tabular-nums text-muted-foreground text-xs">{secondary}</span>
    </li>
  );
}
