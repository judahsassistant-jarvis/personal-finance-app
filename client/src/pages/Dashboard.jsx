import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAccounts } from '../store/accountsSlice.js';
import { fetchDebts } from '../store/debtsSlice.js';
import { fetchBuckets } from '../store/cardBucketsSlice.js';
import { fetchTransactions } from '../store/transactionsSlice.js';
import { formatGBP, CARD_LIKE_SUBTYPES, LIQUIDITY } from '../firebase/schema.js';

/**
 * Minimal connected-data Dashboard.
 *
 * Sprint 4 stub: proves Firestore data flows through Redux and the UI renders.
 * The real Snoop-style Dashboard (safe-to-spend, remaining bills, days-to-payday,
 * discretionary calc) lands in Sprint 4c once pay_cycle + recurring-bills
 * services are wired up.
 */
export default function Dashboard() {
  const dispatch = useDispatch();
  const accounts = useSelector((s) => s.accounts.items);
  const debts = useSelector((s) => s.debts.items);
  const buckets = useSelector((s) => s.cardBuckets.items);
  const txCount = useSelector((s) => s.transactions.items.length);
  const loading = useSelector((s) =>
    s.accounts.loading || s.debts.loading || s.cardBuckets.loading,
  );

  useEffect(() => {
    dispatch(fetchAccounts());
    dispatch(fetchDebts());
    dispatch(fetchBuckets());
    dispatch(fetchTransactions());
  }, [dispatch]);

  if (loading && accounts.length === 0 && debts.length === 0) {
    return <p className="text-gray-500">Loading your data…</p>;
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
      const bucketSum = cardBuckets.reduce((bs, b) => bs + Number(b.balance_pennies || 0), 0);
      return s + bucketSum;
    }, 0);
  const otherDebt = debts
    .filter((d) => !CARD_LIKE_SUBTYPES.has(d.subtype))
    .reduce((s, d) => s + Number(d.balance_pennies || 0), 0);
  const totalDebt = cardLikeDebt + otherDebt;

  const netWorth = liquidTotal + lockedTotal - totalDebt;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <span className="text-xs text-gray-400">Sprint 4 minimal view · Snoop-style in 4c</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card title="Liquid balance" value={formatGBP(liquidTotal)} color="green" />
        <Card title="Locked (ISA/SIPP etc.)" value={formatGBP(lockedTotal)} color="indigo" />
        <Card title="Total debt" value={formatGBP(totalDebt)} color="red" />
        <Card title="Net worth" value={formatGBP(netWorth)} color={netWorth >= 0 ? 'green' : 'red'} />
      </div>

      <Section title="Accounts">
        {accounts.length === 0 ? <Empty msg="No accounts yet." /> : accounts.map((a) => (
          <Row
            key={a.id}
            left={<><span className="font-medium">{a.name}</span>
              <span className="ml-2 text-xs text-gray-500">{a.subtype}</span>
              <span className={`ml-2 text-xs ${a.liquidity === 'liquid' ? 'text-green-600' : 'text-amber-600'}`}>{a.liquidity}</span>
            </>}
            right={formatGBP(a.balance_pennies || 0)}
            rightColor={(a.balance_pennies || 0) >= 0 ? 'text-green-700' : 'text-red-700'}
          />
        ))}
      </Section>

      <Section title="Debts">
        {debts.length === 0 ? <Empty msg="No debts yet." /> : debts.map((d) => {
          const cardBuckets = buckets.filter((b) => b.debt_id === d.id);
          const balance = CARD_LIKE_SUBTYPES.has(d.subtype)
            ? cardBuckets.reduce((s, b) => s + Number(b.balance_pennies || 0), 0)
            : Number(d.balance_pennies || 0);
          return (
            <Row
              key={d.id}
              left={<><span className="font-medium">{d.name}</span>
                <span className="ml-2 text-xs text-gray-500">{d.subtype}</span>
                {d.priority && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">priority</span>}
              </>}
              right={formatGBP(balance)}
              rightColor={balance > 0 ? 'text-red-700' : 'text-green-700'}
            />
          );
        })}
      </Section>

      <p className="text-xs text-gray-400">{txCount} transaction(s) loaded.</p>
    </div>
  );
}

function Card({ title, value, color }) {
  const cls = {
    green: 'bg-green-50 text-green-800 border-green-200',
    red: 'bg-red-50 text-red-800 border-red-200',
    indigo: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  }[color] || 'bg-gray-50 text-gray-800 border-gray-200';
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <div className="text-sm font-medium">{title}</div>
      <div className="text-2xl font-bold mt-1 font-mono">{value}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ left, right, rightColor }) {
  return (
    <div className="flex justify-between items-center py-2 border-b last:border-0">
      <div>{left}</div>
      <span className={`font-mono font-semibold ${rightColor || ''}`}>{right}</span>
    </div>
  );
}

function Empty({ msg }) {
  return <p className="text-gray-500 text-sm">{msg}</p>;
}
