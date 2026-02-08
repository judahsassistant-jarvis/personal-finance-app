import { useEffect, useState } from 'react';
import { getBudgets, createBudget, updateBudget, deleteBudget } from '../api/client';
import FormField from '../components/FormField';
import ErrorAlert from '../components/ErrorAlert';

const CATEGORIES = ['Food', 'Entertainment', 'Transport', 'Shopping', 'Health', 'Bills', 'Subscriptions', 'Savings Reserve', 'Other'];

export default function Budgets() {
  const [budgets, setBudgets] = useState([]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [form, setForm] = useState({ budget_category: '', allocated_amount: '' });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editAmount, setEditAmount] = useState('');

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

  const validate = () => {
    const errs = {};
    if (!form.budget_category) errs.budget_category = 'Please select a category';
    if (!form.allocated_amount || parseFloat(form.allocated_amount) <= 0) {
      errs.allocated_amount = 'Amount must be greater than 0';
    }
    if (form.budget_category && budgets.some(b => b.budget_category === form.budget_category)) {
      errs.budget_category = 'This category already has a budget for this month';
    }
    return errs;
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    try {
      await createBudget({ month: monthDate, ...form, allocated_amount: parseFloat(form.allocated_amount) });
      setForm({ budget_category: '', allocated_amount: '' });
      setErrors({});
      loadBudgets();
    } catch (err) {
      setSubmitError(err?.response?.data?.error || 'Failed to add budget');
    }
  };

  const handleInlineEdit = async (id) => {
    const amount = parseFloat(editAmount);
    if (isNaN(amount) || amount <= 0) return;
    try {
      await updateBudget(id, { allocated_amount: amount });
      setEditingId(null);
      loadBudgets();
    } catch (err) {
      setSubmitError(err?.response?.data?.error || 'Failed to update');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this budget allocation?')) return;
    await deleteBudget(id);
    loadBudgets();
  };

  const total = budgets.reduce((s, b) => s + parseFloat(b.allocated_amount || 0), 0);
  const totalSpent = budgets.reduce((s, b) => s + parseFloat(b.actual_spent || 0), 0);
  const usedCategories = budgets.map(b => b.budget_category);
  const availableCategories = CATEGORIES.filter(c => !usedCategories.includes(c));

  const inputClass = (field) =>
    `border rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 ${errors[field] ? 'border-red-500 bg-red-50' : 'border-gray-300'}`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Monthly Budgets</h1>
      <ErrorAlert message={submitError} onDismiss={() => setSubmitError(null)} />

      <div className="flex items-center gap-4">
        <label className="font-medium">Month:</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          className="border rounded-md px-3 py-2" />
      </div>

      <form onSubmit={handleAdd} className="bg-white rounded-lg shadow p-6 flex flex-wrap gap-4 items-end">
        <FormField label="Category" error={errors.budget_category}>
          <select value={form.budget_category}
            onChange={(e) => { setForm({ ...form, budget_category: e.target.value }); if (errors.budget_category) setErrors({ ...errors, budget_category: null }); }}
            className={inputClass('budget_category')}>
            <option value="">Select...</option>
            {availableCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </FormField>
        <FormField label="Allocated Amount (£)" error={errors.allocated_amount}>
          <input type="number" step="0.01" min="0.01" value={form.allocated_amount}
            onChange={(e) => { setForm({ ...form, allocated_amount: e.target.value }); if (errors.allocated_amount) setErrors({ ...errors, allocated_amount: null }); }}
            className={inputClass('allocated_amount')} placeholder="0.00" />
        </FormField>
        <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 self-end mb-0">Add</button>
      </form>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? <p className="p-6 text-gray-500">Loading...</p> : budgets.length === 0 ? (
          <p className="p-6 text-gray-500">No budgets set for this month.</p>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Allocated</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actual Spent</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Remaining</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {budgets.map((b) => {
                const allocated = parseFloat(b.allocated_amount || 0);
                const spent = parseFloat(b.actual_spent || 0);
                const remaining = allocated - spent;
                return (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium">{b.budget_category}</td>
                    <td className="px-6 py-3 text-right font-mono">
                      {editingId === b.id ? (
                        <div className="flex items-center justify-end gap-1">
                          <span>£</span>
                          <input type="number" step="0.01" value={editAmount}
                            onChange={(e) => setEditAmount(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleInlineEdit(b.id); if (e.key === 'Escape') setEditingId(null); }}
                            className="border rounded px-2 py-1 w-24 text-right text-sm" autoFocus />
                          <button onClick={() => handleInlineEdit(b.id)} className="text-green-600 text-xs">✓</button>
                          <button onClick={() => setEditingId(null)} className="text-gray-400 text-xs">✕</button>
                        </div>
                      ) : (
                        <span onClick={() => { setEditingId(b.id); setEditAmount(String(allocated)); }}
                          className="cursor-pointer hover:text-indigo-600" title="Click to edit">
                          £{allocated.toFixed(2)}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right font-mono text-gray-500">£{spent.toFixed(2)}</td>
                    <td className={`px-6 py-3 text-right font-mono ${remaining < 0 ? 'text-red-600 font-semibold' : 'text-green-600'}`}>
                      £{remaining.toFixed(2)}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button onClick={() => handleDelete(b.id)} className="text-red-600 hover:text-red-900 text-sm">Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50 font-semibold">
              <tr>
                <td className="px-6 py-3">Total</td>
                <td className="px-6 py-3 text-right font-mono">£{total.toFixed(2)}</td>
                <td className="px-6 py-3 text-right font-mono text-gray-500">£{totalSpent.toFixed(2)}</td>
                <td className={`px-6 py-3 text-right font-mono ${(total - totalSpent) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                  £{(total - totalSpent).toFixed(2)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
