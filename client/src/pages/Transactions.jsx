import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchTransactions } from '../store/transactionsSlice';
import { fetchAccounts } from '../store/accountsSlice';
import { updateTransaction } from '../api/client';

const CATEGORIES = ['Bills', 'Subscriptions', 'Food', 'Entertainment', 'Transport', 'Shopping', 'Health', 'Other'];

export default function Transactions() {
  const dispatch = useDispatch();
  const { items: transactions, total, loading } = useSelector((s) => s.transactions);
  const { items: accounts } = useSelector((s) => s.accounts);
  const [filters, setFilters] = useState({ account_id: '', category: '', limit: 50, offset: 0 });

  useEffect(() => { dispatch(fetchAccounts()); }, [dispatch]);
  useEffect(() => { dispatch(fetchTransactions(filters)); }, [dispatch, filters]);

  const handleCategoryChange = async (txnId, category) => {
    await updateTransaction(txnId, { category });
    dispatch(fetchTransactions(filters));
  };

  const handleBillToggle = async (txnId, current) => {
    await updateTransaction(txnId, { is_recurring_bill: !current });
    dispatch(fetchTransactions(filters));
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Transactions ({total})</h1>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 flex gap-4 flex-wrap">
        <select value={filters.account_id}
          onChange={(e) => setFilters({ ...filters, account_id: e.target.value, offset: 0 })}
          className="border rounded-md px-3 py-2 text-sm">
          <option value="">All Accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={filters.category}
          onChange={(e) => setFilters({ ...filters, category: e.target.value, offset: 0 })}
          className="border rounded-md px-3 py-2 text-sm">
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        {loading ? (
          <p className="p-6 text-gray-500">Loading...</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Merchant</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Recurring</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {transactions.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 whitespace-nowrap">{t.date}</td>
                  <td className="px-4 py-2">{t.merchant}</td>
                  <td className={`px-4 py-2 text-right font-mono ${parseFloat(t.amount) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {'\u00a3'}{parseFloat(t.amount).toFixed(2)}
                  </td>
                  <td className="px-4 py-2">
                    <select value={t.category || 'Other'}
                      onChange={(e) => handleCategoryChange(t.id, e.target.value)}
                      className="border rounded px-2 py-1 text-xs">
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <input type="checkbox" checked={t.is_recurring_bill}
                      onChange={() => handleBillToggle(t.id, t.is_recurring_bill)}
                      className="rounded" />
                  </td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{t.account?.name || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > filters.limit && (
        <div className="flex justify-center gap-2">
          <button
            disabled={filters.offset === 0}
            onClick={() => setFilters({ ...filters, offset: Math.max(0, filters.offset - filters.limit) })}
            className="px-4 py-2 bg-white border rounded-md disabled:opacity-50">Previous</button>
          <span className="px-4 py-2 text-gray-600">
            {filters.offset + 1} - {Math.min(filters.offset + filters.limit, total)} of {total}
          </span>
          <button
            disabled={filters.offset + filters.limit >= total}
            onClick={() => setFilters({ ...filters, offset: filters.offset + filters.limit })}
            className="px-4 py-2 bg-white border rounded-md disabled:opacity-50">Next</button>
        </div>
      )}
    </div>
  );
}
