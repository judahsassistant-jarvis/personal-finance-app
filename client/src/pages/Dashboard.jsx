import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Wallet, Lock, TrendingDown, PiggyBank } from 'lucide-react';
import { fetchAccounts } from '../store/accountsSlice.js';
import { fetchDebts } from '../store/debtsSlice.js';
import { fetchBuckets } from '../store/cardBucketsSlice.js';
import { fetchTransactions } from '../store/transactionsSlice.js';
import { formatGBP, CARD_LIKE_SUBTYPES, LIQUIDITY } from '../firebase/schema.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Separator } from '../components/ui/separator.jsx';

/**
 * Minimal connected-data Dashboard.
 * Snoop-style cycle view replaces this in Sprint 4c.
 */
export default function Dashboard() {
  const dispatch = useDispatch();
  const accounts = useSelector((s) => s.accounts.items);
  const debts = useSelector((s) => s.debts.items);
  const buckets = useSelector((s) => s.cardBuckets.items);
  const txCount = useSelector((s) => s.transactions.items.length);
  const loading = useSelector((s) => s.accounts.loading || s.debts.loading || s.cardBuckets.loading);

  useEffect(() => {
    dispatch(fetchAccounts());
    dispatch(fetchDebts());
    dispatch(fetchBuckets());
    dispatch(fetchTransactions());
  }, [dispatch]);

  if (loading && !accounts.length && !debts.length) {
    return <p className="text-muted-foreground">Loading your data…</p>;
  }

  const liquidTotal = accounts
    .filter((a) => a.liquidity === LIQUIDITY.LIQUID)
    .reduce((s, a) => s + Number(a.balance_pennies || 0), 0);
  const lockedTotal = accounts
    .filter((a) => a.liquidity === LIQUIDITY.LOCKED)
    .reduce((s, a) => s + Number(a.balance_pennies || 0), 0);

  const cardLikeDebt = debts
    .filter((d) => CARD_LIKE_SUBTYPES.has(d.subtype))
    .reduce((s, d) => {
      const cardBuckets = buckets.filter((b) => b.debt_id === d.id);
      return s + cardBuckets.reduce((bs, b) => bs + Number(b.balance_pennies || 0), 0);
    }, 0);
  const otherDebt = debts
    .filter((d) => !CARD_LIKE_SUBTYPES.has(d.subtype))
    .reduce((s, d) => s + Number(d.balance_pennies || 0), 0);
  const totalDebt = cardLikeDebt + otherDebt;

  const netWorth = liquidTotal + lockedTotal - totalDebt;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Snapshot of your accounts and debts.</p>
        </div>
        <Badge variant="muted">Sprint 4 · minimal</Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <HeroCard
          icon={<Wallet className="w-4 h-4" />}
          label="Liquid balance"
          value={formatGBP(liquidTotal)}
          caption="Current + savings + cash ISA"
        />
        <HeroCard
          icon={<Lock className="w-4 h-4" />}
          label="Locked"
          value={formatGBP(lockedTotal)}
          caption="ISA, SIPP, investments"
        />
        <HeroCard
          icon={<TrendingDown className="w-4 h-4" />}
          label="Total debt"
          value={formatGBP(totalDebt)}
          caption={`${debts.length} account${debts.length === 1 ? '' : 's'}`}
          negative
        />
        <HeroCard
          icon={<PiggyBank className="w-4 h-4" />}
          label="Net worth"
          value={formatGBP(netWorth)}
          caption="Assets minus debt"
          positive={netWorth >= 0}
          negative={netWorth < 0}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>{accounts.length} account{accounts.length === 1 ? '' : 's'}</CardDescription>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accounts yet.</p>
          ) : (
            <div className="-my-3">
              {accounts.map((a, i) => (
                <div key={a.id}>
                  {i > 0 && <Separator />}
                  <DataRow
                    title={a.name}
                    subtitleParts={[
                      <Badge key="subtype" variant="muted">{a.subtype}</Badge>,
                      <Badge key="liquidity" variant={a.liquidity === 'liquid' ? 'positive' : 'accent'}>{a.liquidity}</Badge>,
                    ]}
                    amount={a.balance_pennies || 0}
                    amountPositive
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Debts</CardTitle>
          <CardDescription>{debts.length} account{debts.length === 1 ? '' : 's'}</CardDescription>
        </CardHeader>
        <CardContent>
          {debts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No debts yet.</p>
          ) : (
            <div className="-my-3">
              {debts.map((d, i) => {
                const cardBuckets = buckets.filter((b) => b.debt_id === d.id);
                const balance = CARD_LIKE_SUBTYPES.has(d.subtype)
                  ? cardBuckets.reduce((s, b) => s + Number(b.balance_pennies || 0), 0)
                  : Number(d.balance_pennies || 0);
                const subtitleParts = [
                  <Badge key="subtype" variant="muted">{d.subtype}</Badge>,
                ];
                if (d.priority) {
                  subtitleParts.push(<Badge key="priority" variant="warning">priority</Badge>);
                }
                if (d.standard_apr) {
                  subtitleParts.push(
                    <span key="apr" className="text-xs text-muted-foreground tabular-nums">
                      {(d.standard_apr * 100).toFixed(1)}% APR
                    </span>,
                  );
                }
                return (
                  <div key={d.id}>
                    {i > 0 && <Separator />}
                    <DataRow
                      title={d.name}
                      subtitleParts={subtitleParts}
                      amount={balance}
                      amountNegative={balance > 0}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        {txCount} transaction{txCount === 1 ? '' : 's'} loaded · Snoop-style cycle view lands in Sprint 4c
      </p>
    </div>
  );
}

function HeroCard({ icon, label, value, caption, positive, negative }) {
  const valueClass = negative
    ? 'text-destructive'
    : positive
      ? 'text-positive'
      : 'text-foreground';
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <CardDescription className="text-xs uppercase tracking-wide">{label}</CardDescription>
        </div>
        <CardTitle className={`text-2xl font-semibold font-mono tabular-nums mt-1 ${valueClass}`}>
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 -mt-2">
        <p className="text-xs text-muted-foreground">{caption}</p>
      </CardContent>
    </Card>
  );
}

function DataRow({ title, subtitleParts, amount, amountPositive, amountNegative }) {
  const cls = amountNegative ? 'text-destructive' : amountPositive ? 'text-foreground' : 'text-foreground';
  return (
    <div className="flex items-center justify-between py-3">
      <div className="min-w-0">
        <div className="font-medium text-sm text-foreground truncate">{title}</div>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          {subtitleParts}
        </div>
      </div>
      <span className={`font-mono tabular-nums font-medium ${cls}`}>
        {formatGBP(amount)}
      </span>
    </div>
  );
}
