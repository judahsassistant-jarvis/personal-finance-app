import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ChevronLeft, ChevronRight, Sparkles, Trash2, Check } from 'lucide-react';
import { fetchTransactions } from '../store/transactionsSlice.js';
import {
  fetchBudgets, addBudget, editBudget, removeBudget,
} from '../store/budgetsSlice.js';
import { generateSuggestions } from '../services/budgetSuggestions.js';
import { KNOWN_CATEGORIES } from '../services/csvParser.js';
import { formatGBP, poundsToPennies, penniesToPounds } from '../firebase/schema.js';
import {
  computeSpendByCategory,
  buildBudgetRows,
  computeBudgetTotals,
  currentMonthKey,
  shiftMonth,
  formatMonthHeader,
} from './budgets/budgetHelpers.js';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card.jsx';
import { Button } from '../components/ui/button.jsx';
import { Input } from '../components/ui/input.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { cn } from '../lib/utils.js';

export default function Budgets() {
  const dispatch = useDispatch();
  const transactions = useSelector((s) => s.transactions.items);
  const budgets = useSelector((s) => s.budgets.items);
  const profile = useSelector((s) => s.auth.profile);
  const loading = useSelector((s) => s.budgets.loading || s.transactions.loading);

  const [monthKey, setMonthKey] = useState(() => currentMonthKey());

  useEffect(() => {
    dispatch(fetchTransactions());
    dispatch(fetchBudgets());
  }, [dispatch]);

  const customCategories = profile?.custom_categories ?? [];
  const availableCategories = useMemo(
    () => [...new Set([...KNOWN_CATEGORIES, ...customCategories])],
    [customCategories],
  );

  const monthBudgets = useMemo(
    () => budgets.filter((b) => b.month === monthKey),
    [budgets, monthKey],
  );

  const spendByCategory = useMemo(
    () => computeSpendByCategory(transactions, monthKey),
    [transactions, monthKey],
  );

  const suggestions = useMemo(() => {
    if (transactions.length === 0) return [];
    return generateSuggestions({
      transactions,
      targetMonth: monthKey,
      lookbackMonths: 3,
      existingBudgets: monthBudgets,
    }).suggestions;
  }, [transactions, monthKey, monthBudgets]);

  const rows = useMemo(
    () => buildBudgetRows({
      spendByCategory,
      budgets: monthBudgets,
      suggestions,
      availableCategories,
    }),
    [spendByCategory, monthBudgets, suggestions, availableCategories],
  );

  const totals = useMemo(() => computeBudgetTotals(rows), [rows]);

  const handleSaveBudget = async (category, pennies, existingId) => {
    if (existingId) {
      if (pennies === 0 || pennies == null) {
        await dispatch(removeBudget(existingId)).unwrap();
      } else {
        await dispatch(editBudget({ id: existingId, amount_pennies: pennies })).unwrap();
      }
    } else {
      if (pennies && pennies > 0) {
        await dispatch(addBudget({
          month: monthKey,
          category,
          amount_pennies: pennies,
        })).unwrap();
      }
    }
  };

  const handleAcceptSuggestion = async (row) => {
    if (!row.suggestion_pennies) return;
    await handleSaveBudget(row.category, row.suggestion_pennies, row.budget_id);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Budgets</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Set a monthly cap per spending category. Suggestions reflect your average over
          the past 3 months. Balance-shifting categories (Transfer, Investment, Debt
          payments, Income) are excluded — they're tracked elsewhere.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost" size="icon"
          onClick={() => setMonthKey((k) => shiftMonth(k, -1))}
          aria-label="Previous month"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="text-base font-semibold tabular-nums min-w-[10ch] text-center">
          {formatMonthHeader(monthKey)}
        </span>
        <Button
          variant="ghost" size="icon"
          onClick={() => setMonthKey((k) => shiftMonth(k, 1))}
          aria-label="Next month"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
        {monthKey !== currentMonthKey() && (
          <Button
            variant="outline" size="sm"
            onClick={() => setMonthKey(currentMonthKey())}
            className="ml-2 h-7 text-xs"
          >
            Today
          </Button>
        )}
      </div>

      <SummaryStrip totals={totals} />

      {loading && rows.length === 0 ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing to budget yet</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Import some statements or add transactions to start budgeting.
            </p>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <BudgetRow
                  key={row.category}
                  row={row}
                  onSave={handleSaveBudget}
                  onAcceptSuggestion={handleAcceptSuggestion}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryStrip({ totals }) {
  const overspent = totals.total_remaining_pennies < 0;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Tile
        label="Spent this month"
        value={formatGBP(totals.total_spent_pennies)}
      />
      <Tile
        label="Budgeted"
        value={formatGBP(totals.total_budget_pennies)}
        sub={`${totals.budgeted_category_count} of ${totals.total_category_count} categories`}
      />
      <Tile
        label={overspent ? 'Over by' : 'Remaining'}
        value={formatGBP(Math.abs(totals.total_remaining_pennies))}
        tone={overspent ? 'destructive' : 'positive'}
      />
    </div>
  );
}

function Tile({ label, value, sub, tone }) {
  return (
    <div className="rounded-md border border-border bg-background px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-lg font-semibold mt-0.5 tabular-nums',
          tone === 'destructive' && 'text-destructive',
          tone === 'positive' && 'text-emerald-600',
        )}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function BudgetRow({ row, onSave, onAcceptSuggestion }) {
  const [draft, setDraft] = useState(
    row.budget_pennies != null ? String(penniesToPounds(row.budget_pennies)) : '',
  );
  const [saving, setSaving] = useState(false);

  // Re-sync draft when the row's budget changes from elsewhere (e.g. suggestion accepted).
  useEffect(() => {
    setDraft(row.budget_pennies != null ? String(penniesToPounds(row.budget_pennies)) : '');
  }, [row.budget_pennies]);

  const draftPennies = useMemo(() => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0) return null;
    return poundsToPennies(n);
  }, [draft]);

  const dirty = draftPennies !== row.budget_pennies && (draftPennies !== 0 || row.budget_pennies != null);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await onSave(row.category, draftPennies, row.budget_id);
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!row.budget_id || saving) return;
    setSaving(true);
    try {
      await onSave(row.category, 0, row.budget_id);
    } finally {
      setSaving(false);
    }
  };

  const accept = async () => {
    setSaving(true);
    try {
      await onAcceptSuggestion(row);
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="min-w-[140px] flex-shrink-0">
          <div className="font-medium text-sm">{row.category}</div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {formatGBP(row.spent_pennies)} spent
          </div>
        </div>
        <div className="flex-1 min-w-[200px]">
          <ProgressBar row={row} />
        </div>
        <form onSubmit={submit} className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">£</span>
          <Input
            type="number"
            inputMode="decimal"
            step="1"
            min="0"
            placeholder={
              row.suggestion_pennies != null
                ? penniesToPounds(row.suggestion_pennies).toFixed(0)
                : '0'
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-8 w-24 text-sm tabular-nums"
            aria-label={`${row.category} budget`}
          />
          <Button
            type="submit" size="sm" variant={dirty ? 'accent' : 'ghost'}
            disabled={!dirty || saving}
            className="h-8 px-2"
            title="Save"
          >
            <Check className="w-3.5 h-3.5" />
          </Button>
          {row.budget_id && (
            <Button
              type="button" size="sm" variant="ghost"
              onClick={clear} disabled={saving}
              className="h-8 px-2 text-muted-foreground"
              title="Clear budget"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </form>
      </div>
      {row.suggestion_pennies != null && row.suggestion_pennies !== row.budget_pennies && (
        <div className="mt-1.5 ml-[152px] flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="w-3 h-3 text-accent-foreground" />
          <span>
            3-month avg suggests{' '}
            <span className="text-foreground font-medium tabular-nums">
              {formatGBP(row.suggestion_pennies)}
            </span>
            {row.suggestion_confidence && (
              <Badge variant="secondary" className="ml-1.5 text-[9px] uppercase">
                {row.suggestion_confidence}
              </Badge>
            )}
          </span>
          <Button
            variant="ghost" size="sm"
            onClick={accept} disabled={saving}
            className="h-6 px-2 text-xs"
          >
            Use
          </Button>
        </div>
      )}
    </li>
  );
}

function ProgressBar({ row }) {
  if (row.budget_pennies == null) {
    return <div className="text-xs text-muted-foreground italic">No budget set</div>;
  }
  const pct = Math.min(100, (row.utilisation || 0) * 100);
  const overspent = row.spent_pennies > row.budget_pennies;
  let band = 'bg-emerald-500';
  if (overspent) band = 'bg-destructive';
  else if (pct >= 80) band = 'bg-amber-500';
  return (
    <div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', band)} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-muted-foreground mt-1 tabular-nums">
        {formatGBP(row.spent_pennies)} of {formatGBP(row.budget_pennies)}{' '}
        {overspent ? (
          <span className="text-destructive">
            (over by {formatGBP(row.spent_pennies - row.budget_pennies)})
          </span>
        ) : (
          <span>({formatGBP(row.budget_pennies - row.spent_pennies)} left)</span>
        )}
      </div>
    </div>
  );
}
