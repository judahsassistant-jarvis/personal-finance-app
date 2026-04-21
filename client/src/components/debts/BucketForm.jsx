import { useState, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { addBucket, editBucket } from '../../store/cardBucketsSlice.js';
import {
  emptyBucketForm,
  bucketToForm,
  validateBucketForm,
  bucketFormToPayload,
} from './formHelpers.js';
import { Input } from '../ui/input.jsx';
import { Button } from '../ui/button.jsx';

export default function BucketForm({ debtId, editingBucket, onClose }) {
  const dispatch = useDispatch();
  const [form, setForm] = useState(editingBucket ? bucketToForm(editingBucket) : { ...emptyBucketForm });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(editingBucket ? bucketToForm(editingBucket) : { ...emptyBucketForm });
    setErrors({});
    setSubmitError(null);
  }, [editingBucket]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    const errs = validateBucketForm(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    try {
      const payload = bucketFormToPayload(form, debtId);
      if (editingBucket) {
        await dispatch(editBucket({ id: editingBucket.id, ...payload })).unwrap();
      } else {
        await dispatch(addBucket(payload)).unwrap();
      }
      onClose();
    } catch (err) {
      setSubmitError(err?.message || 'Failed to save bucket');
    } finally {
      setSaving(false);
    }
  };

  const field = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-secondary/30 border border-border rounded-md p-3 space-y-3"
    >
      {submitError && (
        <div className="text-xs text-destructive">{submitError}</div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <MiniField label="Bucket name" error={errors.name}>
          <Input
            placeholder="e.g. Balance Transfer"
            value={form.name}
            onChange={(e) => field('name', e.target.value)}
          />
        </MiniField>
        <MiniField label="Balance (£)" error={errors.balance}>
          <Input
            type="number" step="0.01" min="0"
            value={form.balance}
            onChange={(e) => field('balance', e.target.value)}
          />
        </MiniField>
        <MiniField label="APR %" error={errors.apr}>
          <Input
            type="number" step="0.01" min="0" max="100"
            placeholder="19.9"
            value={form.apr}
            onChange={(e) => field('apr', e.target.value)}
          />
        </MiniField>
        <div className="flex items-end gap-4">
          <label className="flex items-center gap-2 text-sm pb-2">
            <input
              type="checkbox"
              checked={form.is_promo}
              onChange={(e) => field('is_promo', e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <span>Promo rate</span>
          </label>
          {form.is_promo && (
            <div className="flex-1">
              <label className="block text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wide">Ends</label>
              <Input
                type="date"
                value={form.promo_end}
                onChange={(e) => field('promo_end', e.target.value)}
              />
              {errors.promo_end && <p className="mt-1 text-xs text-destructive">{errors.promo_end}</p>}
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : editingBucket ? 'Save bucket' : 'Add bucket'}
        </Button>
      </div>
    </form>
  );
}

function MiniField({ label, error, children }) {
  return (
    <div>
      <label className="block text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wide">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
