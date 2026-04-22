import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  CreditCard, Landmark, ShoppingBag, Banknote, Plus, Clock,
  Pencil, Trash2,
} from 'lucide-react';
import { fetchDebts, removeDebt } from '../store/debtsSlice.js';
import { fetchBuckets, removeBucket } from '../store/cardBucketsSlice.js';
import {
  DEBT_SUBTYPES,
  CARD_LIKE_SUBTYPES,
  formatGBP,
} from '../firebase/schema.js';
import {
  enrichDebt,
  computeTotals,
  byPriorityThenBalance,
} from './debtPlannerHelpers.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Separator } from '../components/ui/separator.jsx';
import DebtForm from '../components/debts/DebtForm.jsx';
import BucketForm from '../components/debts/BucketForm.jsx';
import StrategyCard from '../components/debts/StrategyCard.jsx';
import StrategyComparison from '../components/debts/StrategyComparison.jsx';

// Group spec: display order, label, icon, subtype membership test.
const GROUPS = [
  {
    key: 'cards',
    label: 'Credit cards',
    icon: CreditCard,
    includes: (d) => CARD_LIKE_SUBTYPES.has(d.subtype) && d.subtype !== DEBT_SUBTYPES.STORE_CARD,
  },
  {
    key: 'store',
    label: 'Store cards',
    icon: ShoppingBag,
    includes: (d) => d.subtype === DEBT_SUBTYPES.STORE_CARD,
  },
  {
    key: 'loans',
    label: 'Loans',
    icon: Landmark,
    includes: (d) => d.subtype === DEBT_SUBTYPES.PERSONAL_LOAN,
  },
  {
    key: 'bnpl',
    label: 'Buy now, pay later',
    icon: Clock,
    includes: (d) => d.subtype === DEBT_SUBTYPES.BNPL,
  },
  {
    key: 'overdrafts',
    label: 'Overdrafts',
    icon: Banknote,
    includes: (d) => d.subtype === DEBT_SUBTYPES.OVERDRAFT,
  },
];

export default function DebtPlanner() {
  const dispatch = useDispatch();
  const debts = useSelector((s) => s.debts.items);
  const buckets = useSelector((s) => s.cardBuckets.items);
  const loading = useSelector((s) => s.debts.loading || s.cardBuckets.loading);

  // UI state: form = null | { mode: 'add' } | { mode: 'edit', debt }
  const [debtForm, setDebtForm] = useState(null);
  // Bucket form state: null | { debtId, bucket? }
  const [bucketForm, setBucketForm] = useState(null);

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

  const allRows = useMemo(
    () => debts.map((d) => enrichDebt(d, bucketsByDebtId.get(d.id) || [])),
    [debts, bucketsByDebtId],
  );

  const grouped = useMemo(() => {
    return GROUPS.map((group) => {
      const rows = allRows
        .filter((r) => group.includes(r.debt))
        .slice()
        .sort(byPriorityThenBalance);
      return { ...group, rows };
    });
  }, [allRows]);

  const totals = useMemo(() => computeTotals(debts, bucketsByDebtId), [debts, bucketsByDebtId]);

  if (loading && debts.length === 0 && !debtForm) {
    return <p className="text-muted-foreground">Loading your debts…</p>;
  }

  const handleDeleteDebt = async (debt) => {
    const debtBuckets = bucketsByDebtId.get(debt.id) || [];
    const extra = debtBuckets.length > 0 ? ` and ${debtBuckets.length} bucket${debtBuckets.length === 1 ? '' : 's'}` : '';
    if (!window.confirm(`Delete "${debt.name}"${extra}? This cannot be undone.`)) return;
    for (const b of debtBuckets) {
      await dispatch(removeBucket(b.id)).unwrap();
    }
    await dispatch(removeDebt(debt.id)).unwrap();
  };

  const handleDeleteBucket = async (bucket) => {
    if (!window.confirm(`Delete bucket "${bucket.name}"?`)) return;
    await dispatch(removeBucket(bucket.id)).unwrap();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Debt Planner</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {debts.length} debt{debts.length === 1 ? '' : 's'} · {formatGBP(totals.totalPennies)} outstanding · {formatGBP(totals.minMonthlyPennies)}/mo minimums
          </p>
        </div>
        {!debtForm && (
          <Button onClick={() => setDebtForm({ mode: 'add' })}>
            <Plus className="w-4 h-4" />Add debt
          </Button>
        )}
      </div>

      {debtForm && (
        <DebtForm
          editingDebt={debtForm.mode === 'edit' ? debtForm.debt : null}
          onClose={() => setDebtForm(null)}
        />
      )}

      {debts.length > 0 && !debtForm && (
        <>
          <StrategyCard rows={allRows} />
          <StrategyComparison debts={debts} buckets={buckets} />
        </>
      )}

      {debts.length === 0 && !debtForm ? (
        <Card>
          <CardHeader>
            <CardTitle>No debts tracked yet</CardTitle>
            <CardDescription>Add your first debt to build a payoff plan.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            group.rows.length > 0 && (
              <DebtGroup
                key={group.key}
                group={group}
                bucketForm={bucketForm}
                onEditDebt={(debt) => setDebtForm({ mode: 'edit', debt })}
                onDeleteDebt={handleDeleteDebt}
                onAddBucket={(debtId) => setBucketForm({ debtId, bucket: null })}
                onEditBucket={(debtId, bucket) => setBucketForm({ debtId, bucket })}
                onDeleteBucket={handleDeleteBucket}
                onCloseBucketForm={() => setBucketForm(null)}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}

function DebtGroup({
  group, bucketForm,
  onEditDebt, onDeleteDebt,
  onAddBucket, onEditBucket, onDeleteBucket, onCloseBucketForm,
}) {
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
            <DebtRow
              row={row}
              bucketForm={bucketForm}
              onEditDebt={onEditDebt}
              onDeleteDebt={onDeleteDebt}
              onAddBucket={onAddBucket}
              onEditBucket={onEditBucket}
              onDeleteBucket={onDeleteBucket}
              onCloseBucketForm={onCloseBucketForm}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DebtRow({
  row, bucketForm,
  onEditDebt, onDeleteDebt,
  onAddBucket, onEditBucket, onDeleteBucket, onCloseBucketForm,
}) {
  const { debt, totalBalance, min, blendedApr, promo, buckets } = row;
  const aprPct = blendedApr > 0 ? `${(blendedApr * 100).toFixed(1)}%` : '—';
  const minLabel = min > 0 ? `${formatGBP(min)}/mo min` : 'No contractual min';
  const dueLabel = debt.payment_due_day ? `Due day ${debt.payment_due_day}` : null;
  const isCardLike = CARD_LIKE_SUBTYPES.has(debt.subtype);
  const bucketFormOpenHere = bucketForm && bucketForm.debtId === debt.id;

  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-4">
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
        <div className="flex items-center gap-3">
          <span className={`font-mono tabular-nums font-medium ${totalBalance > 0 ? 'text-destructive' : 'text-positive'}`}>
            {formatGBP(totalBalance)}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => onEditDebt(debt)} title="Edit debt">
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onDeleteDebt(debt)} title="Delete debt">
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
            </Button>
          </div>
        </div>
      </div>

      {isCardLike && (
        <div className="mt-3 ml-2 border-l-2 border-border pl-3 space-y-2">
          {buckets.length === 0 && !bucketFormOpenHere && (
            <p className="text-xs text-muted-foreground italic">No buckets yet — add one to track a balance.</p>
          )}
          {buckets.map((b) => {
            const isEditingThis = bucketFormOpenHere && bucketForm.bucket?.id === b.id;
            if (isEditingThis) {
              return (
                <BucketForm
                  key={b.id}
                  debtId={debt.id}
                  editingBucket={b}
                  onClose={onCloseBucketForm}
                />
              );
            }
            return (
              <BucketRow
                key={b.id}
                bucket={b}
                onEdit={() => onEditBucket(debt.id, b)}
                onDelete={() => onDeleteBucket(b)}
              />
            );
          })}
          {bucketFormOpenHere && !bucketForm.bucket && (
            <BucketForm
              debtId={debt.id}
              editingBucket={null}
              onClose={onCloseBucketForm}
            />
          )}
          {!bucketFormOpenHere && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onAddBucket(debt.id)}
              className="h-7 text-xs"
            >
              <Plus className="w-3 h-3" />Add bucket
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function BucketRow({ bucket, onEdit, onDelete }) {
  const aprPct = `${(Number(bucket.apr || 0) * 100).toFixed(1)}%`;
  const promoBadge = bucket.is_promo
    ? <Badge variant="accent">promo</Badge>
    : null;
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm truncate">{bucket.name}</span>
          {promoBadge}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">APR {aprPct}</div>
      </div>
      <span className="font-mono tabular-nums text-sm">{formatGBP(bucket.balance_pennies || 0)}</span>
      <div className="flex items-center">
        <Button variant="ghost" size="icon" onClick={onEdit} title="Edit bucket" className="h-7 w-7">
          <Pencil className="w-3 h-3" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onDelete} title="Delete bucket" className="h-7 w-7">
          <Trash2 className="w-3 h-3 text-destructive" />
        </Button>
      </div>
    </div>
  );
}
