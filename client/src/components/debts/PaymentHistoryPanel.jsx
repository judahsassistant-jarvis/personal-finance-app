import { useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ArrowDownCircle, Receipt, Trash2 } from 'lucide-react';
import { removeBalanceSnapshot } from '../../store/balanceSnapshotsSlice.js';
import { formatGBP } from '../../firebase/schema.js';
import { Button } from '../ui/button.jsx';
import { Separator } from '../ui/separator.jsx';
import {
  buildPaymentTimeline,
  summarisePaymentTimeline,
} from './paymentHistoryHelpers.js';

export default function PaymentHistoryPanel({ debt }) {
  const dispatch = useDispatch();
  const transactions = useSelector((s) => s.transactions.items);
  const snapshots = useSelector((s) => s.balanceSnapshots.items);

  const timeline = useMemo(
    () => buildPaymentTimeline({ debtId: debt.id, transactions, snapshots }),
    [debt.id, transactions, snapshots],
  );
  const summary = useMemo(() => summarisePaymentTimeline(timeline), [timeline]);

  const handleDeleteSnapshot = async (snapshot) => {
    if (!window.confirm(`Delete the snapshot from ${formatTimestamp(snapshot.as_of_date)}?`)) return;
    await dispatch(removeBalanceSnapshot(snapshot.id)).unwrap();
  };

  return (
    <div className="mt-3 rounded-md border border-border p-3 space-y-3">
      <PanelHeader summary={summary} />
      <Separator />
      {timeline.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          No payments or snapshots yet. Tag a transaction on the Transactions page, or record a
          statement balance via the button above.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {timeline.map((row) => (
            <li key={row.id}>
              {row.kind === 'payment'
                ? <PaymentRow tx={row.data} />
                : <SnapshotRow snapshot={row.data} onDelete={() => handleDeleteSnapshot(row.data)} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PanelHeader({ summary }) {
  const balanceDelta = summary.oldestSnapshotBalance != null && summary.newestSnapshotBalance != null
    ? summary.oldestSnapshotBalance - summary.newestSnapshotBalance
    : null;

  return (
    <div className="flex items-baseline justify-between gap-3 flex-wrap text-xs">
      <div className="text-muted-foreground uppercase tracking-wide font-medium">
        Payment history
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>
          <span className="text-foreground font-medium tabular-nums">{summary.paymentCount}</span>
          {' '}payment{summary.paymentCount === 1 ? '' : 's'}
          {summary.paymentPennies > 0 && (
            <> · <span className="text-foreground tabular-nums">{formatGBP(summary.paymentPennies)}</span> total</>
          )}
        </span>
        <span>
          <span className="text-foreground font-medium tabular-nums">{summary.snapshotCount}</span>
          {' '}snapshot{summary.snapshotCount === 1 ? '' : 's'}
          {balanceDelta != null && balanceDelta > 0 && (
            <> · <span className="text-positive tabular-nums">{formatGBP(balanceDelta)}</span> cleared</>
          )}
          {balanceDelta != null && balanceDelta < 0 && (
            <> · <span className="text-destructive tabular-nums">{formatGBP(Math.abs(balanceDelta))}</span> added</>
          )}
        </span>
      </div>
    </div>
  );
}

function PaymentRow({ tx }) {
  const amount = Math.abs(Number(tx.amount_pennies || 0));
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <ArrowDownCircle className="w-3.5 h-3.5 mt-0.5 text-positive shrink-0" />
        <div className="min-w-0">
          <div className="text-sm truncate">{tx.merchant || '(no merchant)'}</div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {formatTimestamp(tx.date)}
            {tx.category && tx.category !== 'Debt Payment' && <> · {tx.category}</>}
          </div>
        </div>
      </div>
      <div className="tabular-nums font-mono text-sm text-foreground whitespace-nowrap">
        −{formatGBP(amount)}
      </div>
    </div>
  );
}

function SnapshotRow({ snapshot, onDelete }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <Receipt className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <div className="text-sm">Statement balance</div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {formatTimestamp(snapshot.as_of_date)}
            {snapshot.notes && <> · {snapshot.notes}</>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="tabular-nums font-mono text-sm whitespace-nowrap">
          {formatGBP(snapshot.balance_pennies || 0)}
        </span>
        <Button
          variant="ghost" size="icon" onClick={onDelete}
          title="Delete snapshot" className="h-6 w-6"
        >
          <Trash2 className="w-3 h-3 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

function formatTimestamp(d) {
  if (!d) return '—';
  const ms =
    d instanceof Date ? d.getTime()
      : typeof d === 'string' ? new Date(d).getTime()
      : typeof d?.toDate === 'function' ? d.toDate().getTime()
      : typeof d?.seconds === 'number' ? d.seconds * 1000
      : 0;
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
