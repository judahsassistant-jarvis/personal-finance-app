import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchCards, addCard, editCard, removeCard, addBucket, editBucket, removeBucket } from '../store/cardsSlice';
import FormField from '../components/FormField';
import ErrorAlert from '../components/ErrorAlert';

function validateCardForm(form) {
  const errors = {};
  if (!form.name || form.name.trim().length < 1) errors.name = 'Card name is required';
  if (form.standard_apr !== '' && form.standard_apr !== undefined) {
    const apr = parseFloat(form.standard_apr);
    if (isNaN(apr) || apr < 0) errors.standard_apr = 'APR must be 0 or greater';
    if (apr > 1) errors.standard_apr = 'Enter as decimal (e.g. 0.20 for 20%)';
  }
  if (form.min_percentage !== '') {
    const mp = parseFloat(form.min_percentage);
    if (isNaN(mp) || mp < 0 || mp > 1) errors.min_percentage = 'Enter as decimal (e.g. 0.02 for 2%)';
  }
  if (form.min_floor !== '') {
    const mf = parseFloat(form.min_floor);
    if (isNaN(mf) || mf < 0) errors.min_floor = 'Must be 0 or greater';
  }
  if (form.credit_limit !== '') {
    const cl = parseFloat(form.credit_limit);
    if (isNaN(cl) || cl < 0) errors.credit_limit = 'Must be 0 or greater';
  }
  if (form.statement_date !== '') {
    const sd = parseInt(form.statement_date);
    if (isNaN(sd) || sd < 1 || sd > 31) errors.statement_date = 'Must be 1-31';
  }
  return errors;
}

function validateBucketForm(form) {
  const errors = {};
  if (!form.bucket_name || form.bucket_name.trim().length < 1) errors.bucket_name = 'Bucket name is required';
  if (form.current_balance === '' || form.current_balance === undefined) {
    errors.current_balance = 'Balance is required';
  } else {
    const bal = parseFloat(form.current_balance);
    if (isNaN(bal) || bal < 0) errors.current_balance = 'Must be 0 or greater';
  }
  if (form.promo_apr !== '') {
    const apr = parseFloat(form.promo_apr);
    if (isNaN(apr) || apr < 0) errors.promo_apr = 'Must be 0 or greater';
    if (apr > 1) errors.promo_apr = 'Enter as decimal (e.g. 0.20 for 20%)';
  }
  if (form.promo_end_date) {
    const d = new Date(form.promo_end_date);
    if (isNaN(d.getTime())) errors.promo_end_date = 'Invalid date';
  }
  return errors;
}

const emptyCardForm = { name: '', standard_apr: '', min_percentage: '0.02', min_floor: '25', credit_limit: '', statement_date: '' };
const emptyBucketForm = { bucket_name: '', bucket_type: 'purchases', current_balance: '', promo_apr: '0', promo_end_date: '' };

export default function CreditCards() {
  const dispatch = useDispatch();
  const { items: cards, loading } = useSelector((s) => s.cards);
  const [cardForm, setCardForm] = useState({ ...emptyCardForm });
  const [editingCardId, setEditingCardId] = useState(null);
  const [cardErrors, setCardErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [bucketForm, setBucketForm] = useState({ ...emptyBucketForm });
  const [bucketErrors, setBucketErrors] = useState({});
  const [showBucketForm, setShowBucketForm] = useState(null);
  const [editingBucketId, setEditingBucketId] = useState(null);

  useEffect(() => { dispatch(fetchCards()); }, [dispatch]);

  const handleCardSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    const errs = validateCardForm(cardForm);
    setCardErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const payload = {
      name: cardForm.name.trim(),
      standard_apr: cardForm.standard_apr ? parseFloat(cardForm.standard_apr) : null,
      min_percentage: parseFloat(cardForm.min_percentage),
      min_floor: parseFloat(cardForm.min_floor),
      credit_limit: cardForm.credit_limit ? parseFloat(cardForm.credit_limit) : null,
      statement_date: cardForm.statement_date ? parseInt(cardForm.statement_date) : null,
    };

    try {
      if (editingCardId) {
        await dispatch(editCard({ id: editingCardId, ...payload })).unwrap();
        setEditingCardId(null);
      } else {
        await dispatch(addCard(payload)).unwrap();
      }
      setCardForm({ ...emptyCardForm });
      setCardErrors({});
    } catch (err) {
      setSubmitError(err?.message || err?.error || 'Failed to save card');
    }
  };

  const startEditCard = (card) => {
    setEditingCardId(card.id);
    setCardForm({
      name: card.name,
      standard_apr: card.standard_apr != null ? String(card.standard_apr) : '',
      min_percentage: String(card.min_percentage || '0.02'),
      min_floor: String(card.min_floor || '25'),
      credit_limit: card.credit_limit != null ? String(card.credit_limit) : '',
      statement_date: card.statement_date != null ? String(card.statement_date) : '',
    });
    setCardErrors({});
    setSubmitError(null);
  };

  const cancelEditCard = () => {
    setEditingCardId(null);
    setCardForm({ ...emptyCardForm });
    setCardErrors({});
  };

  const handleBucketSubmit = async (e, cardId) => {
    e.preventDefault();
    const errs = validateBucketForm(bucketForm);
    setBucketErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const payload = {
      card_id: cardId,
      bucket_name: bucketForm.bucket_name.trim(),
      bucket_type: bucketForm.bucket_type,
      current_balance: parseFloat(bucketForm.current_balance),
      promo_apr: bucketForm.promo_apr ? parseFloat(bucketForm.promo_apr) : 0,
      promo_end_date: bucketForm.promo_end_date || null,
    };

    try {
      if (editingBucketId) {
        await dispatch(editBucket({ id: editingBucketId, cardId, ...payload })).unwrap();
        setEditingBucketId(null);
      } else {
        await dispatch(addBucket(payload)).unwrap();
      }
      setBucketForm({ ...emptyBucketForm });
      setBucketErrors({});
      setShowBucketForm(null);
    } catch (err) {
      setSubmitError(err?.message || 'Failed to save bucket');
    }
  };

  const startEditBucket = (bucket, cardId) => {
    setEditingBucketId(bucket.id);
    setShowBucketForm(cardId);
    setBucketForm({
      bucket_name: bucket.bucket_name,
      bucket_type: bucket.bucket_type,
      current_balance: String(bucket.current_balance),
      promo_apr: String(bucket.promo_apr || '0'),
      promo_end_date: bucket.promo_end_date ? bucket.promo_end_date.slice(0, 10) : '',
    });
    setBucketErrors({});
  };

  const cancelBucket = () => {
    setShowBucketForm(null);
    setEditingBucketId(null);
    setBucketForm({ ...emptyBucketForm });
    setBucketErrors({});
  };

  const inputClass = (errs, field) =>
    `border rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 w-full text-sm ${
      errs[field] ? 'border-red-500 bg-red-50' : 'border-gray-300'
    }`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Credit Cards</h1>
      <ErrorAlert message={submitError} onDismiss={() => setSubmitError(null)} />

      {/* Card Form */}
      <form onSubmit={handleCardSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold">{editingCardId ? 'Edit Credit Card' : 'Add Credit Card'}</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <FormField label="Card Name" error={cardErrors.name}>
            <input type="text" placeholder="e.g. Virgin Card" value={cardForm.name}
              onChange={(e) => setCardForm({ ...cardForm, name: e.target.value })}
              className={inputClass(cardErrors, 'name')} />
          </FormField>
          <FormField label="Standard APR" error={cardErrors.standard_apr} hint="Decimal: 0.20 = 20%">
            <input type="number" step="0.001" placeholder="0.296" value={cardForm.standard_apr}
              onChange={(e) => setCardForm({ ...cardForm, standard_apr: e.target.value })}
              className={inputClass(cardErrors, 'standard_apr')} />
          </FormField>
          <FormField label="Min Payment %" error={cardErrors.min_percentage} hint="Decimal: 0.02 = 2%">
            <input type="number" step="0.01" placeholder="0.02" value={cardForm.min_percentage}
              onChange={(e) => setCardForm({ ...cardForm, min_percentage: e.target.value })}
              className={inputClass(cardErrors, 'min_percentage')} />
          </FormField>
          <FormField label="Min Floor (£)" error={cardErrors.min_floor}>
            <input type="number" step="0.01" placeholder="25" value={cardForm.min_floor}
              onChange={(e) => setCardForm({ ...cardForm, min_floor: e.target.value })}
              className={inputClass(cardErrors, 'min_floor')} />
          </FormField>
          <FormField label="Credit Limit (£)" error={cardErrors.credit_limit}>
            <input type="number" step="0.01" placeholder="5000" value={cardForm.credit_limit}
              onChange={(e) => setCardForm({ ...cardForm, credit_limit: e.target.value })}
              className={inputClass(cardErrors, 'credit_limit')} />
          </FormField>
          <FormField label="Statement Date" error={cardErrors.statement_date} hint="Day of month (1-31)">
            <input type="number" min="1" max="31" placeholder="15" value={cardForm.statement_date}
              onChange={(e) => setCardForm({ ...cardForm, statement_date: e.target.value })}
              className={inputClass(cardErrors, 'statement_date')} />
          </FormField>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700">
            {editingCardId ? 'Update Card' : 'Add Card'}
          </button>
          {editingCardId && (
            <button type="button" onClick={cancelEditCard}
              className="bg-gray-200 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-300">Cancel</button>
          )}
        </div>
      </form>

      {/* Cards List */}
      {loading ? <p className="text-gray-500">Loading...</p> : cards.length === 0 ? (
        <p className="text-gray-500">No credit cards yet.</p>
      ) : (
        <div className="space-y-4">
          {cards.map((card) => {
            const totalDebt = (card.buckets || []).reduce((s, b) => s + parseFloat(b.current_balance || 0), 0);
            return (
              <div key={card.id} className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">{card.name}</h3>
                    <p className="text-sm text-gray-500">
                      APR: {(parseFloat(card.standard_apr || 0) * 100).toFixed(1)}% |
                      Min: {(parseFloat(card.min_percentage || 0) * 100).toFixed(0)}% or £{parseFloat(card.min_floor || 0).toFixed(0)} |
                      Limit: £{parseFloat(card.credit_limit || 0).toFixed(0)} |
                      Statement: {card.statement_date}th |
                      Total Debt: <span className="font-semibold text-red-600">£{totalDebt.toFixed(2)}</span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => startEditCard(card)} className="text-indigo-600 hover:text-indigo-900 text-sm">Edit</button>
                    <button onClick={() => { if (window.confirm('Delete this card and all its buckets?')) dispatch(removeCard(card.id)); }}
                      className="text-red-600 hover:text-red-900 text-sm">Delete</button>
                  </div>
                </div>

                {/* Buckets */}
                <div className="ml-4 space-y-2">
                  <h4 className="text-sm font-medium text-gray-600">Buckets</h4>
                  {(card.buckets || []).length === 0 && (
                    <p className="text-xs text-gray-400">No buckets. Add one to track balances.</p>
                  )}
                  {(card.buckets || []).map((b) => (
                    <div key={b.id} className="flex justify-between items-center py-1 border-b text-sm">
                      <span>
                        <span className="font-medium">{b.bucket_name}</span>
                        <span className="ml-2 text-gray-500">({b.bucket_type})</span>
                        {b.promo_end_date && <span className="ml-2 text-orange-500">Promo ends: {b.promo_end_date.slice(0, 10)}</span>}
                      </span>
                      <span className="flex items-center gap-4">
                        <span className="font-mono">£{parseFloat(b.current_balance || 0).toFixed(2)}</span>
                        <span className="text-gray-500">APR: {(parseFloat(b.promo_apr || 0) * 100).toFixed(1)}%</span>
                        <button onClick={() => startEditBucket(b, card.id)} className="text-indigo-500 hover:text-indigo-700 text-xs">edit</button>
                        <button onClick={() => dispatch(removeBucket({ id: b.id, cardId: card.id }))}
                          className="text-red-500 hover:text-red-700">×</button>
                      </span>
                    </div>
                  ))}

                  {showBucketForm === card.id ? (
                    <form onSubmit={(e) => handleBucketSubmit(e, card.id)} className="space-y-2 mt-2 p-3 bg-gray-50 rounded">
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                        <FormField error={bucketErrors.bucket_name}>
                          <input type="text" placeholder="Bucket name" value={bucketForm.bucket_name}
                            onChange={(e) => setBucketForm({ ...bucketForm, bucket_name: e.target.value })}
                            className={inputClass(bucketErrors, 'bucket_name')} />
                        </FormField>
                        <FormField>
                          <select value={bucketForm.bucket_type}
                            onChange={(e) => setBucketForm({ ...bucketForm, bucket_type: e.target.value })}
                            className="border rounded px-2 py-2 text-sm w-full">
                            <option value="purchases">Purchases</option>
                            <option value="transfer">Balance Transfer</option>
                          </select>
                        </FormField>
                        <FormField error={bucketErrors.current_balance}>
                          <input type="number" step="0.01" placeholder="Balance" value={bucketForm.current_balance}
                            onChange={(e) => setBucketForm({ ...bucketForm, current_balance: e.target.value })}
                            className={inputClass(bucketErrors, 'current_balance')} />
                        </FormField>
                        <FormField error={bucketErrors.promo_apr} hint="Decimal">
                          <input type="number" step="0.001" placeholder="Promo APR" value={bucketForm.promo_apr}
                            onChange={(e) => setBucketForm({ ...bucketForm, promo_apr: e.target.value })}
                            className={inputClass(bucketErrors, 'promo_apr')} />
                        </FormField>
                        <FormField error={bucketErrors.promo_end_date}>
                          <input type="date" value={bucketForm.promo_end_date}
                            onChange={(e) => setBucketForm({ ...bucketForm, promo_end_date: e.target.value })}
                            className={inputClass(bucketErrors, 'promo_end_date')} />
                        </FormField>
                      </div>
                      <div className="flex gap-2">
                        <button type="submit" className="bg-green-600 text-white px-3 py-1 rounded text-sm">
                          {editingBucketId ? 'Update' : 'Save'}
                        </button>
                        <button type="button" onClick={cancelBucket}
                          className="bg-gray-200 text-gray-700 px-3 py-1 rounded text-sm">Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <button onClick={() => { setShowBucketForm(card.id); setEditingBucketId(null); setBucketForm({ ...emptyBucketForm }); }}
                      className="text-indigo-600 hover:text-indigo-800 text-sm mt-1">+ Add Bucket</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
