import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAccounts, addAccount, editAccount, removeAccount } from '../store/accountsSlice';
import FormField from '../components/FormField';
import ErrorAlert from '../components/ErrorAlert';

function validateAccountForm(form) {
  const errors = {};
  if (!form.name || form.name.trim().length < 2) errors.name = 'Name is required (min 2 characters)';
  if (form.name && form.name.trim().length > 100) errors.name = 'Name must be 100 characters or less';
  if (form.balance === '' || form.balance === null || form.balance === undefined) {
    errors.balance = 'Balance is required';
  } else if (isNaN(parseFloat(form.balance))) {
    errors.balance = 'Balance must be a valid number';
  }
  if (!['checking', 'savings'].includes(form.type)) errors.type = 'Invalid account type';
  return errors;
}

export default function Accounts() {
  const dispatch = useDispatch();
  const { items: accounts, loading, error: apiError } = useSelector((s) => s.accounts);
  const [form, setForm] = useState({ name: '', type: 'checking', balance: '' });
  const [editingId, setEditingId] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => { dispatch(fetchAccounts()); }, [dispatch]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    const validationErrors = validateAccountForm(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    const payload = { ...form, name: form.name.trim(), balance: parseFloat(form.balance) };
    try {
      if (editingId) {
        await dispatch(editAccount({ id: editingId, ...payload })).unwrap();
        setEditingId(null);
      } else {
        await dispatch(addAccount(payload)).unwrap();
      }
      setForm({ name: '', type: 'checking', balance: '' });
      setErrors({});
    } catch (err) {
      setSubmitError(err?.message || err?.error || 'Failed to save account');
    }
  };

  const startEdit = (account) => {
    setEditingId(account.id);
    setForm({ name: account.name, type: account.type, balance: String(account.balance) });
    setErrors({});
    setSubmitError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ name: '', type: 'checking', balance: '' });
    setErrors({});
    setSubmitError(null);
  };

  const handleDelete = (id) => {
    if (window.confirm('Delete this account? All associated transactions will also be deleted.')) {
      dispatch(removeAccount(id));
    }
  };

  const inputClass = (field) =>
    `border rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-full ${
      errors[field] ? 'border-red-500 bg-red-50' : 'border-gray-300'
    }`;

  const totalBalance = accounts.reduce((s, a) => s + parseFloat(a.balance || 0), 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>

      <ErrorAlert message={submitError} onDismiss={() => setSubmitError(null)} />

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold">{editingId ? 'Edit Account' : 'Add Account'}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Account Name" error={errors.name}>
            <input type="text" placeholder="e.g. Current Account A" value={form.name}
              onChange={(e) => { setForm({ ...form, name: e.target.value }); if (errors.name) setErrors({ ...errors, name: null }); }}
              className={inputClass('name')} />
          </FormField>
          <FormField label="Account Type" error={errors.type}>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
              className={inputClass('type')}>
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
            </select>
          </FormField>
          <FormField label="Balance (£)" error={errors.balance}>
            <input type="number" step="0.01" placeholder="0.00" value={form.balance}
              onChange={(e) => { setForm({ ...form, balance: e.target.value }); if (errors.balance) setErrors({ ...errors, balance: null }); }}
              className={inputClass('balance')} />
          </FormField>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700">
            {editingId ? 'Update' : 'Add Account'}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit}
              className="bg-gray-200 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-300">Cancel</button>
          )}
        </div>
      </form>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <p className="p-6 text-gray-500">Loading...</p>
        ) : accounts.length === 0 ? (
          <p className="p-6 text-gray-500">No accounts yet.</p>
        ) : (
          <>
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
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td className="px-6 py-3" colSpan={2}>Total</td>
                  <td className="px-6 py-3 text-right font-mono">{'\u00a3'}{totalBalance.toFixed(2)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
