import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAccounts } from '../store/accountsSlice';
import { fetchCards } from '../store/cardsSlice';
import { fetchTransactions } from '../store/transactionsSlice';
import { getAvailableFunds } from '../api/client';

export default function Dashboard() {
  const dispatch = useDispatch();
  const { items: accounts, loading: accLoading } = useSelector((s) => s.accounts);
  const { items: cards, loading: cardsLoading } = useSelector((s) => s.cards);
  const { total: txnTotal } = useSelector((s) => s.transactions);
  const [available, setAvailable] = useState(null);
  const [availLoading, setAvailLoading] = useState(false);

  const currentMonth = new Date().toISOString().slice(0, 7) + '-01';

  useEffect(() => {
    dispatch(fetchAccounts());
    dispatch(fetchCards());
    dispatch(fetchTransactions({ limit: 1 }));
  }, [dispatch]);

  useEffect(() => {
    async function loadAvailable() {
      setAvailLoading(true);
      try {
        const { data } = await getAvailableFunds(currentMonth);
        setAvailable(data);
      } catch (err) {
        console.error('Failed to load available funds:', err);
      }
      setAvailLoading(false);
    }
    loadAvailable();
  }, []);

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
        <SummaryCard title="Total Balance" value={`£${totalBalance.toFixed(2)}`}
          color="bg-green-50 text-green-700 border-green-200" />
        <SummaryCard title="Total Debt" value={`£${totalDebt.toFixed(2)}`}
          color="bg-red-50 text-red-700 border-red-200" />
        <SummaryCard title="Accounts" value={accounts.length}
          color="bg-blue-50 text-blue-700 border-blue-200" />
        <SummaryCard title="Available for Debt"
          value={availLoading ? '...' : available ? `£${available.available_for_debt.toFixed(2)}` : '—'}
          color="bg-amber-50 text-amber-700 border-amber-200" />
      </div>

      {/* Available Funds Breakdown */}
      {available && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">This Month's Cash Flow</h2>
          <div className="space-y-3">
            <FlowRow label="Account Balances" value={available.total_balance} positive />
            <FlowRow label="Recurring Bills" value={-available.recurring_bills} />
            {Object.entries(available.bill_breakdown || {}).map(([cat, amt]) => (
              <FlowRow key={cat} label={`  └ ${cat}`} value={-amt} sub />
            ))}
            <FlowRow label="Budgeted Spending" value={-available.budgeted_spending} />
            {(available.budgets || []).map((b, i) => (
              <FlowRow key={i} label={`  └ ${b.category}`} value={-b.allocated} sub />
            ))}
            <FlowRow label="Credit Card Min Payments" value={-available.credit_card_min_payments} />
            {(available.card_min_payments || []).map((c, i) => (
              <FlowRow key={i} label={`  └ ${c.card_name} (bal: £${c.balance.toFixed(0)})`} value={-c.min_payment} sub />
            ))}
            <div className="border-t pt-2 mt-2">
              <FlowRow label="Total Outflow" value={-available.total_outflow} bold />
            </div>
            <div className="border-t-2 border-indigo-200 pt-2 mt-2">
              <div className="flex justify-between items-center">
                <span className="font-bold text-lg">Available for Debt Repayment</span>
                <span className={`font-bold text-lg font-mono ${available.available_for_debt > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  £{available.available_for_debt.toFixed(2)}
                </span>
              </div>
              {available.raw_available < 0 && (
                <p className="text-red-600 text-sm mt-1">⚠️ Your outflows exceed your balance by £{Math.abs(available.raw_available).toFixed(2)}</p>
              )}
            </div>
          </div>
        </div>
      )}

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
                <span className="font-mono font-semibold">£{parseFloat(a.balance).toFixed(2)}</span>
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
                    <span className="ml-2 text-xs text-gray-500">APR: {(parseFloat(c.standard_apr || 0) * 100).toFixed(1)}%</span>
                    <span className="ml-2 text-xs text-gray-400">{(c.buckets || []).length} bucket(s)</span>
                  </div>
                  <span className={`font-mono font-semibold ${debt > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    £{debt.toFixed(2)}
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

function FlowRow({ label, value, positive, sub, bold }) {
  const color = value > 0 ? 'text-green-600' : value < 0 ? 'text-red-600' : 'text-gray-600';
  return (
    <div className={`flex justify-between items-center ${sub ? 'text-sm text-gray-500' : ''} ${bold ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span className={`font-mono ${color}`}>
        {value >= 0 ? '' : '-'}£{Math.abs(value).toFixed(2)}
      </span>
    </div>
  );
}
