import { useEffect, useState } from 'react';
import { getBudgets, createBudget, updateBudget, deleteBudget, getBudgetSuggestions, applyBudgetSuggestions } from '../api/client';
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
  const [suggestions, setSuggestions] = useState(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState(new Set());

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

  const loadSuggestions = async () => {
    setSuggestionsLoading(true);
    try {
      const { data } = await getBudgetSuggestions(monthDate);
      setSuggestions(data);
      setSelectedSuggestions(new Set(
        data.suggestions.filter((s) => !s.already_budgeted).map((s) => s.category)
      ));
    } catch (err) {
      console.error(err);
    }
    setSuggestionsLoading(false);
  };

  const toggleSuggestion = (category) => {
    setSelectedSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const applySuggestions = async () => {
    if (selectedSuggestions.size === 0) return;
    const cats = suggestions.suggestions
      .filter((s) => selectedSuggestions.has(s.category))
      .map((s) => ({ category: s.category, amount: s.suggested_amount }));
    try {
      await applyBudgetSuggestions({ month: monthDate, categories: cats });
      setSuggestions(null);
      loadBudgets();
    } catch (err) {
      setSubmitError(err?.response?.data?.error || 'Failed to apply suggestions');
    }
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

      {/* Suggestions */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Budget Suggestions</h2>
          <button
            onClick={loadSuggestions}
            disabled={suggestionsLoading}
            className="px-4 py-2 bg-amber-500 text-white rounded-md text-sm font-medium hover:bg-amber-600 disabled:bg-amber-300"
          >
            {suggestionsLoading ? 'Analyzing...' : 'Get Suggestions'}
          </button>
        </div>
        {suggestions && (
          <>
            <p className="text-sm text-gray-500 mb-3">
              Based on {suggestions.analysis.transactionCount} transactions over {suggestions.analysis.monthsAnalyzed} month(s).
              Total suggested: £{suggestions.analysis.totalSuggestedMonthly}
            </p>
            {suggestions.suggestions.length === 0 ? (
              <p className="text-gray-400 text-sm">No spending patterns found. Import more transactions first.</p>
            ) : (
              <>
                <div className="space-y-2 mb-4">
                  {suggestions.suggestions.map((s) => (
                    <div key={s.category} className="flex items-center justify-between py-2 border-b">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedSuggestions.has(s.category)}
                          onChange={() => toggleSuggestion(s.category)}
                          className="rounded"
                        />
                        <span className="font-medium">{s.category}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          s.confidence === 'high' ? 'bg-green-100 text-green-700' :
                          s.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>{s.confidence}</span>
                        {s.already_budgeted && (
                          <span className="text-xs text-indigo-600">(current: £{s.current_allocation?.toFixed(2)})</span>
                        )}
                      </label>
                      <div className="text-sm text-right">
                        <span className="font-mono font-medium">£{s.suggested_amount}</span>
                        <span className="text-gray-400 ml-2">(avg: £{s.monthly_average})</span>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={applySuggestions}
                  disabled={selectedSuggestions.size === 0}
                  className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:bg-gray-300"
                >
                  Apply {selectedSuggestions.size} Selected
                </button>
              </>
            )}
          </>
        )}
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
