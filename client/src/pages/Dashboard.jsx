import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAccounts } from '../store/accountsSlice';
import { fetchCards } from '../store/cardsSlice';
import { fetchTransactions } from '../store/transactionsSlice';

export default function Dashboard() {
  const dispatch = useDispatch();
  const { items: accounts, loading: accLoading } = useSelector((s) => s.accounts);
  const { items: cards, loading: cardsLoading } = useSelector((s) => s.cards);
  const { total: txnTotal } = useSelector((s) => s.transactions);

  useEffect(() => {
    dispatch(fetchAccounts());
    dispatch(fetchCards());
    dispatch(fetchTransactions({ limit: 1 }));
  }, [dispatch]);

  const totalBalance = accounts.reduce((s, a) => s + parseFloat(a.balance || 0), 0);
  const totalDebt = cards.reduce((s, c) => {
    const bucketDebt = (c.buckets || []).reduce((bs, b) => bs + parseFloat(b.current_balance || 0), 0);
    return s + bucketDebt;
  }, 0);

  if (accLoading || cardsLoading) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard
          title="Total Balance"
          value={`\u00a3${totalBalance.toFixed(2)}`}
          color="bg-green-50 text-green-700 border-green-200"
        />
        <SummaryCard
          title="Total Debt"
          value={`\u00a3${totalDebt.toFixed(2)}`}
          color="bg-red-50 text-red-700 border-red-200"
        />
        <SummaryCard
          title="Accounts"
          value={accounts.length}
          color="bg-blue-50 text-blue-700 border-blue-200"
        />
        <SummaryCard
          title="Transactions"
          value={txnTotal}
          color="bg-purple-50 text-purple-700 border-purple-200"
        />
      </div>

      {/* Accounts */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Account Summary</h2>
        {accounts.length === 0 ? (
          <p className="text-gray-500">No accounts yet. Add one in the Accounts page.</p>
        ) : (
          <div className="space-y-2">
            {accounts.map((a) => (
              <div key={a.id} className="flex justify-between items-center py-2 border-b last:border-0">
                <div>
                  <span className="font-medium">{a.name}</span>
                  <span className="ml-2 text-xs text-gray-500 capitalize">{a.type}</span>
                </div>
                <span className="font-mono font-semibold">{'\u00a3'}{parseFloat(a.balance).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Credit Cards */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Credit Cards</h2>
        {cards.length === 0 ? (
          <p className="text-gray-500">No credit cards yet. Add one in the Credit Cards page.</p>
        ) : (
          <div className="space-y-3">
            {cards.map((c) => {
              const debt = (c.buckets || []).reduce((s, b) => s + parseFloat(b.current_balance || 0), 0);
              return (
                <div key={c.id} className="flex justify-between items-center py-2 border-b last:border-0">
                  <div>
                    <span className="font-medium">{c.name}</span>
                    <span className="ml-2 text-xs text-gray-500">
                      APR: {(parseFloat(c.standard_apr || 0) * 100).toFixed(1)}%
                    </span>
                    <span className="ml-2 text-xs text-gray-400">
                      {(c.buckets || []).length} bucket(s)
                    </span>
                  </div>
                  <span className={`font-mono font-semibold ${debt > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {'\u00a3'}{debt.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ title, value, color }) {
  return (
    <div className={`rounded-lg border p-4 ${color}`}>
      <div className="text-sm font-medium">{title}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
