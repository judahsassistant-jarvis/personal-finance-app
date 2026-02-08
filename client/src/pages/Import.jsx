import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAccounts } from '../store/accountsSlice';
import { importCSV, saveImport, clearImport, updateImportTransaction } from '../store/transactionsSlice';

const CATEGORIES = ['Bills', 'Subscriptions', 'Food', 'Entertainment', 'Transport', 'Shopping', 'Health', 'Other'];

export default function Import() {
  const dispatch = useDispatch();
  const { items: accounts } = useSelector((s) => s.accounts);
  const { importResult, importLoading } = useSelector((s) => s.transactions);
  const [accountId, setAccountId] = useState('');
  const fileRef = useRef();

  useEffect(() => { dispatch(fetchAccounts()); }, [dispatch]);

  const handleUpload = () => {
    const file = fileRef.current?.files[0];
    if (!file || !accountId) return;
    dispatch(importCSV({ file, accountId }));
  };

  const handleConfirm = () => {
    if (importResult) {
      dispatch(saveImport(importResult.transactions));
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Import Statement</h1>

      {/* Upload Form */}
      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold">Upload CSV</h2>
        <p className="text-sm text-gray-500">Supports Nationwide, Revolut, and Virgin Money statement formats.</p>
        <div className="flex gap-4 flex-wrap items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Account</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
              className="border rounded-md px-3 py-2">
              <option value="">Select account...</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CSV File</label>
            <input type="file" accept=".csv" ref={fileRef}
              className="border rounded-md px-3 py-2 text-sm" />
          </div>
          <button onClick={handleUpload} disabled={importLoading || !accountId}
            className="bg-indigo-600 text-white px-6 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50">
            {importLoading ? 'Parsing...' : 'Upload & Parse'}
          </button>
        </div>
      </div>

      {/* Import Results */}
      {importResult && (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="font-medium text-green-800">
              Parsed {importResult.count} transactions ({importResult.format} format)
            </p>
            <p className="text-sm text-green-600">
              Total out: {'\u00a3'}{importResult.total_debit} | Total in: {'\u00a3'}{importResult.total_credit}
            </p>
          </div>

          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Merchant</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Amount</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Category</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Bill?</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {importResult.transactions.map((t, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 whitespace-nowrap">{t.date}</td>
                    <td className="px-3 py-1.5">{t.merchant}</td>
                    <td className={`px-3 py-1.5 text-right font-mono ${t.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {'\u00a3'}{parseFloat(t.amount).toFixed(2)}
                    </td>
                    <td className="px-3 py-1.5">
                      <select value={t.category || 'Other'}
                        onChange={(e) => dispatch(updateImportTransaction({ index: i, category: e.target.value }))}
                        className="border rounded px-1.5 py-0.5 text-xs">
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <input type="checkbox" checked={t.is_recurring_bill || false}
                        onChange={() => dispatch(updateImportTransaction({ index: i, is_recurring_bill: !t.is_recurring_bill }))}
                        className="rounded" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <button onClick={handleConfirm}
              className="bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700">
              Confirm & Save ({importResult.count} transactions)
            </button>
            <button onClick={() => dispatch(clearImport())}
              className="bg-gray-200 text-gray-700 px-6 py-2 rounded-md hover:bg-gray-300">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
