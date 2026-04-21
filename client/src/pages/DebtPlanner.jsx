import { useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { CreditCard, Landmark, ShoppingBag, Banknote, Plus, Clock } from 'lucide-react';
import { fetchDebts } from '../store/debtsSlice.js';
import { fetchBuckets } from '../store/cardBucketsSlice.js';
import {
  DEBT_SUBTYPES,
  CARD_LIKE_SUBTYPES,
  INSTALLMENT_SUBTYPES,
  REVOLVING_SUBTYPES,
  formatGBP,
} from '../firebase/schema.js';
import {
  calcCardMinPayment,
  calcInstallmentMinPayment,
} from '../services/debtForecast.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Separator } from '../components/ui/separator.jsx';

// Group spec: display order, label, icon, subtype membership test.
const GROUPS = [
  {
    key: 'cards',
    label: 'Credit cards',
    icon: CreditCard,
    includes: (d) => CARD_LIKE_SUBTYPES.has(d.subtype) && d.subtype !== DEBT_SUBTYPES.STORE_CARD,
    empty: 'No credit cards.',
  },
  {
    key: 'store',
    label: 'Store cards',
    icon: ShoppingBag,
    includes: (d) => d.subtype === DEBT_SUBTYPES.STORE_CARD,
    empty: 'No store cards.',
  },
  {
    key: 'loans',
    label: 'Loans',
    icon: Landmark,
    includes: (d) => d.subtype === DEBT_SUBTYPES.PERSONAL_LOAN,
    empty: 'No personal loans.',
  },
  {
    key: 'bnpl',
    label: 'Buy now, pay later',
    icon: Clock,
    includes: (d) => d.subtype === DEBT_SUBTYPES.BNPL,
    empty: 'No BNPL agreements.',
  },
  {
    key: 'overdrafts',
    label: 'Overdrafts',
    icon: Banknote,
    includes: (d) => d.subtype === DEBT_SUBTYPES.OVERDRAFT,
    empty: 'No overdrafts.',
  },
];

export default function DebtPlanner() {
  const dispatch = useDispatch();
  const debts = useSelector((s) => s.debts.items);
  const buckets = useSelector((s) => s.cardBuckets.items);
  const loading = useSelector((s) => s.debts.loading || s.cardBuckets.loading);

  useEffect(() => {
    dispatch(fetchDebts());
    dispatch(fetchBuckets());
  }, [dispatch]);

  const bucketsByDebtId = useMemo(() => {
    const map = new Map();
    for (const b of buckets) {
      if (!map.has(b.debt_id)) map.set(b.debt_id, []);
      map.get(b.debt_id).push(b);
    }
    return map;
  }, [buckets]);

  const grouped = useMemo(() => {
    return GROUPS.map((group) => {
      const rows = debts
        .filter(group.includes)
        .map((d) => enrichDebt(d, bucketsByDebtId.get(d.id) || []))
        .sort(byPriorityThenBalance);
      return { ...group, rows };
    });
  }, [debts, bucketsByDebtId]);

  const totals = useMemo(() => computeTotals(debts, bucketsByDebtId), [debts, bucketsByDebtId]);

  if (loading && debts.length === 0) {
    return <p className="text-muted-foreground">Loading your debts…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Debt Planner</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {debts.length} debt{debts.length === 1 ? '' : 's'} · {formatGBP(totals.totalPennies)} outstanding · {formatGBP(totals.minMonthlyPennies)}/mo minimums
          </p>
        </div>
        <Button disabled title="Coming in the next slice">
          <Plus className="w-4 h-4" />Add debt
        </Button>
      </div>

      {debts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No debts tracked yet</CardTitle>
            <CardDescription>Add your first debt to build a payoff plan.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            group.rows.length > 0 && <DebtGroup key={group.key} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}

function enrichDebt(debt, debtBuckets) {
  if (CARD_LIKE_SUBTYPES.has(debt.subtype)) {
    const totalBalance = debtBuckets.reduce((s, b) => s + Number(b.balance_pennies || 0), 0);
    const min = calcCardMinPayment(debt, totalBalance);
    const blendedApr = computeWeightedApr(debtBuckets);
    const promo = computePromoInfo(debtBuckets);
    return { debt, buckets: debtBuckets, totalBalance, min, blendedApr, promo };
  }
  if (INSTALLMENT_SUBTYPES.has(debt.subtype)) {
    const totalBalance = Number(debt.balance_pennies || 0);
    const min = calcInstallmentMinPayment(debt, totalBalance);
    return { debt, buckets: [], totalBalance, min, blendedApr: Number(debt.standard_apr || 0), promo: null };
  }
  if (REVOLVING_SUBTYPES.has(debt.subtype)) {
    return {
      debt,
      buckets: [],
      totalBalance: Number(debt.balance_pennies || 0),
      min: 0,
      blendedApr: Number(debt.standard_apr || 0),
      promo: null,
    };
  }
  return { debt, buckets: [], totalBalance: 0, min: 0, blendedApr: 0, promo: null };
}

export function computeWeightedApr(buckets) {
  if (!buckets.length) return 0;
  const now = new Date();
  let totalBalance = 0;
  let weighted = 0;
  for (const b of buckets) {
    const bal = Math.max(0, Number(b.balance_pennies || 0));
    if (bal <= 0) continue;
    const effective = effectiveAprFor(b, now);
    totalBalance += bal;
    weighted += bal * effective;
  }
  if (totalBalance <= 0) return 0;
  return weighted / totalBalance;
}

function effectiveAprFor(bucket, now) {
  const apr = Number(bucket.apr ?? 0);
  if (!bucket.is_promo) return apr;
  if (!bucket.promo_end) return apr;
  const end = toDate(bucket.promo_end);
  return end && end >= now ? apr : 0;
}

export function computePromoInfo(buckets) {
  const now = new Date();
  let soonest = null;
  for (const b of buckets) {
    if (!b.is_promo || !b.promo_end) continue;
    const end = toDate(b.promo_end);
    if (!end || end < now) continue;
    if (!soonest || end < soonest.end) {
      soonest = { end, bucket: b };
    }
  }
  if (!soonest) return null;
  const days = Math.ceil((soonest.end - now) / (1000 * 60 * 60 * 24));
  return {
    days,
    end: soonest.end,
    bucketName: soonest.bucket.name,
    balancePennies: Number(soonest.bucket.balance_pennies || 0),
  };
}

function computeTotals(debts, bucketsByDebtId) {
  let totalPennies = 0;
  let minMonthlyPennies = 0;
  for (const d of debts) {
    if (CARD_LIKE_SUBTYPES.has(d.subtype)) {
      const bal = (bucketsByDebtId.get(d.id) || []).reduce((s, b) => s + Number(b.balance_pennies || 0), 0);
      totalPennies += bal;
      minMonthlyPennies += calcCardMinPayment(d, bal);
    } else if (INSTALLMENT_SUBTYPES.has(d.subtype)) {
      const bal = Number(d.balance_pennies || 0);
      totalPennies += bal;
      minMonthlyPennies += calcInstallmentMinPayment(d, bal);
    } else if (REVOLVING_SUBTYPES.has(d.subtype)) {
      totalPennies += Number(d.balance_pennies || 0);
    }
  }
  return { totalPennies, minMonthlyPennies };
}

function byPriorityThenBalance(a, b) {
  if (a.debt.priority !== b.debt.priority) return a.debt.priority ? -1 : 1;
  return b.totalBalance - a.totalBalance;
}

function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') return new Date(v);
  if (v && typeof v.toDate === 'function') return v.toDate();
  if (v && typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  return null;
}

function DebtGroup({ group }) {
  const Icon = group.icon;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <CardTitle>{group.label}</CardTitle>
          <Badge variant="muted">{group.rows.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0 -my-3">
        {group.rows.map((row, i) => (
          <div key={row.debt.id}>
            {i > 0 && <Separator />}
            <DebtRow row={row} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DebtRow({ row }) {
  const { debt, totalBalance, min, blendedApr, promo } = row;
  const aprPct = blendedApr > 0 ? `${(blendedApr * 100).toFixed(1)}%` : '—';
  const minLabel = min > 0 ? `${formatGBP(min)}/mo min` : 'No contractual min';
  const dueLabel = debt.payment_due_day ? `Due day ${debt.payment_due_day}` : null;

  return (
    <div className="py-3 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{debt.name}</span>
          {debt.priority && <Badge variant="warning">priority</Badge>}
          {promo && (
            <Badge variant={promo.days <= 30 ? 'destructive' : 'accent'}>
              Promo ends in {promo.days}d
            </Badge>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span className="tabular-nums">APR {aprPct}</span>
          <span className="tabular-nums">{minLabel}</span>
          {dueLabel && <span>{dueLabel}</span>}
        </div>
      </div>
      <span className={`font-mono tabular-nums font-medium ${totalBalance > 0 ? 'text-destructive' : 'text-positive'}`}>
        {formatGBP(totalBalance)}
      </span>
    </div>
  );
}
