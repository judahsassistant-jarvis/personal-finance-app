import { useEffect, useState } from 'react';
import { getBudgets, createBudget, updateBudget, deleteBudget } from '../api/client';

const CATEGORIES = ['Food', 'Entertainment', 'Transport', 'Shopping', 'Health', 'Savings Reserve', 'Other'];

export default function Budgets() {
  const [budgets, setBudgets] = useState([]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [form, setForm] = useState({ budget_category: '', allocated_amount: '' });
  const [loading, setLoading] = useState(false);

  const monthDate = `${month}-01`;

  const loadBudgets = async () => {
    setLoading(true);
    try {
      const { data } = await getBudgets(monthDate);
      setBudgets(data);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => { loadBudgets(); }, [month]);

  const handleAdd = async (e) => {
    e.preventDefault();
    await createBudget({ month: monthDate, ...form, allocated_amount: parseFloat(form.allocated_amount) });
    setForm({ budget_category: '', allocated_amount: '' });
    loadBudgets();
  };

  const handleUpdate = async (id, allocated_amount) => {
    await updateBudget(id, { allocated_amount: parseFloat(allocated_amount) });
    loadBudgets();
  };

  const handleDelete = async (id) => {
    await deleteBudget(id);
    loadBudgets();
  };

  const total = budgets.reduce((s, b) => s + parseFloat(b.allocated_amount || 0), 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Monthly Budgets</h1>

      <div className="flex items-center gap-4">
        <label className="font-medium">Month:</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          className="border rounded-md px-3 py-2" />
      </div>

      <form onSubmit={handleAdd} className="bg-white rounded-lg shadow p-6 flex gap-4 items-end">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
          <select value={form.budget_category}
            onChange={(e) => setForm({ ...form, budget_category: e.target.value })}
            className="border rounded-md px-3 py-2" required>
            <option value="">Select...</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Allocated Amount</label>
          <input type="number" step="0.01" value={form.allocated_amount}
            onChange={(e) => setForm({ ...form, allocated_amount: e.target.value })}
            className="border rounded-md px-3 py-2" required />
        </div>
        <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700">Add</button>
      </form>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? <p className="p-6 text-gray-500">Loading...</p> : budgets.length === 0 ? (
          <p className="p-6 text-gray-500">No budgets set for this month.</p>
        ) : (
          <>
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Allocated</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actual Spent</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {budgets.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium">{b.budget_category}</td>
                    <td className="px-6 py-3 text-right font-mono">{'\u00a3'}{parseFloat(b.allocated_amount).toFixed(2)}</td>
                    <td className="px-6 py-3 text-right font-mono text-gray-500">{'\u00a3'}{parseFloat(b.actual_spent || 0).toFixed(2)}</td>
                    <td className="px-6 py-3 text-right">
                      <button onClick={() => handleDelete(b.id)} className="text-red-600 hover:text-red-900 text-sm">Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td className="px-6 py-3">Total</td>
                  <td className="px-6 py-3 text-right font-mono">{'\u00a3'}{total.toFixed(2)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
