import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { Timestamp } from 'firebase/firestore';
import { X } from 'lucide-react';
import { addBalanceSnapshot } from '../../store/balanceSnapshotsSlice.js';
import { editDebt } from '../../store/debtsSlice.js';
import { formatGBP, poundsToPennies, penniesToPounds } from '../../firebase/schema.js';
import { Input } from '../ui/input.jsx';
import { Button } from '../ui/button.jsx';

/**
 * Inline form for recording a new balance snapshot against a debt. Snapshots
 * are the authoritative monthly-statement balance; on save we also patch the
 * debt's `balance_pennies` to match, so the rest of the app reflects the
 * latest state without waiting for an extra step.
 *
 * Card-like debts derive their balance from buckets (not balance_pennies), so
 * the parent only mounts this for installment + revolving subtypes.
 */
export default function RecordSnapshotForm({ debt, currentBalancePennies, onClose }) {
  const dispatch = useDispatch();
  const [asOf, setAsOf] = useState(() => todayAsInput());
  const [amount, setAmount] = useState(() => penniesToPoundsString(currentBalancePennies));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const parsed = parseAmount(amount);
    if (parsed == null) {
      setError('Enter a valid balance (0 or greater)');
      return;
    }
    if (!asOf) {
      setError('Pick a statement date');
      return;
    }
    setSaving(true);
    try {
      await dispatch(addBalanceSnapshot({
        debt_id: debt.id,
        as_of_date: Timestamp.fromDate(new Date(asOf)),
        balance_pennies: parsed,
        notes: notes.trim() || undefined,
      })).unwrap();
      // Patch the debt to match — the snapshot is the authoritative current
      // balance, so the rest of the UI (forecast, bars, milestones) should
      // immediately reflect it.
      await dispatch(editDebt({ id: debt.id, balance_pennies: parsed })).unwrap();
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to save snapshot');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-3 rounded-md border border-border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Record statement balance</div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} title="Cancel">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="As-of date">
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </Field>
        <Field
          label="Statement balance (£)"
          hint={`Current: ${formatGBP(currentBalancePennies)}`}
        >
          <Input
            type="number" step="0.01" min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <Input
          type="text"
          placeholder="e.g. April statement, balance after refund"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save snapshot'}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function todayAsInput() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function penniesToPoundsString(pennies) {
  if (pennies == null) return '';
  return penniesToPounds(pennies).toFixed(2);
}

function parseAmount(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return poundsToPennies(n);
}
