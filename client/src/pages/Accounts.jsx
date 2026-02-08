import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAccounts, addAccount, editAccount, removeAccount } from '../store/accountsSlice';

export default function Accounts() {
  const dispatch = useDispatch();
  const { items: accounts, loading } = useSelector((s) => s.accounts);
  const [form, setForm] = useState({ name: '', type: 'checking', balance: '' });
  const [editingId, setEditingId] = useState(null);

  useEffect(() => { dispatch(fetchAccounts()); }, [dispatch]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = { ...form, balance: parseFloat(form.balance) };
    if (editingId) {
      dispatch(editAccount({ id: editingId, ...payload }));
      setEditingId(null);
    } else {
      dispatch(addAccount(payload));
    }
    setForm({ name: '', type: 'checking', balance: '' });
  };

  const startEdit = (account) => {
    setEditingId(account.id);
    setForm({ name: account.name, type: account.type, balance: account.balance });
  };

  const handleDelete = (id) => {
    if (window.confirm('Delete this account? All associated transactions will also be deleted.')) {
      dispatch(removeAccount(id));
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold">{editingId ? 'Edit Account' : 'Add Account'}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input
            type="text"
            placeholder="Account name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="border rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            required
          />
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="border rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500"
          >
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
          </select>
          <input
            type="number"
            step="0.01"
            placeholder="Balance"
            value={form.balance}
            onChange={(e) => setForm({ ...form, balance: e.target.value })}
            className="border rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500"
            required
          />
        </div>
        <div className="flex gap-2">
          <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700">
            {editingId ? 'Update' : 'Add Account'}
          </button>
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setForm({ name: '', type: 'checking', balance: '' }); }}
              className="bg-gray-200 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-300">
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <p className="p-6 text-gray-500">Loading...</p>
        ) : accounts.length === 0 ? (
          <p className="p-6 text-gray-500">No accounts yet.</p>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Balance</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {accounts.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium">{a.name}</td>
                  <td className="px-6 py-4 capitalize text-gray-600">{a.type}</td>
                  <td className="px-6 py-4 text-right font-mono">{'\u00a3'}{parseFloat(a.balance).toFixed(2)}</td>
                  <td className="px-6 py-4 text-right space-x-2">
                    <button onClick={() => startEdit(a)} className="text-indigo-600 hover:text-indigo-900 text-sm">Edit</button>
                    <button onClick={() => handleDelete(a.id)} className="text-red-600 hover:text-red-900 text-sm">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
