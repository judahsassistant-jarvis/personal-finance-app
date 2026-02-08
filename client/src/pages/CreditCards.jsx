import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchCards, addCard, editCard, removeCard, addBucket, editBucket, removeBucket } from '../store/cardsSlice';

export default function CreditCards() {
  const dispatch = useDispatch();
  const { items: cards, loading } = useSelector((s) => s.cards);
  const [cardForm, setCardForm] = useState({ name: '', standard_apr: '', min_percentage: '0.02', min_floor: '25', credit_limit: '', statement_date: '' });
  const [bucketForm, setBucketForm] = useState({ card_id: '', bucket_name: '', bucket_type: 'purchases', current_balance: '', promo_apr: '0', promo_end_date: '' });
  const [showBucketForm, setShowBucketForm] = useState(null);

  useEffect(() => { dispatch(fetchCards()); }, [dispatch]);

  const handleAddCard = (e) => {
    e.preventDefault();
    dispatch(addCard({
      ...cardForm,
      standard_apr: parseFloat(cardForm.standard_apr),
      min_percentage: parseFloat(cardForm.min_percentage),
      min_floor: parseFloat(cardForm.min_floor),
      credit_limit: parseFloat(cardForm.credit_limit),
      statement_date: parseInt(cardForm.statement_date),
    }));
    setCardForm({ name: '', standard_apr: '', min_percentage: '0.02', min_floor: '25', credit_limit: '', statement_date: '' });
  };

  const handleAddBucket = (e, cardId) => {
    e.preventDefault();
    dispatch(addBucket({
      ...bucketForm,
      card_id: cardId,
      current_balance: parseFloat(bucketForm.current_balance),
      promo_apr: parseFloat(bucketForm.promo_apr),
      promo_end_date: bucketForm.promo_end_date || null,
    }));
    setBucketForm({ card_id: '', bucket_name: '', bucket_type: 'purchases', current_balance: '', promo_apr: '0', promo_end_date: '' });
    setShowBucketForm(null);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Credit Cards</h1>

      {/* Add Card Form */}
      <form onSubmit={handleAddCard} className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold">Add Credit Card</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <input type="text" placeholder="Card name" value={cardForm.name}
            onChange={(e) => setCardForm({ ...cardForm, name: e.target.value })}
            className="border rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500" required />
          <input type="number" step="0.001" placeholder="Standard APR (e.g. 0.296)"
            value={cardForm.standard_apr}
            onChange={(e) => setCardForm({ ...cardForm, standard_apr: e.target.value })}
            className="border rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500" />
          <input type="number" step="0.01" placeholder="Min % (e.g. 0.02)"
            value={cardForm.min_percentage}
            onChange={(e) => setCardForm({ ...cardForm, min_percentage: e.target.value })}
            className="border rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500" />
          <input type="number" step="0.01" placeholder="Min floor (e.g. 25)"
            value={cardForm.min_floor}
            onChange={(e) => setCardForm({ ...cardForm, min_floor: e.target.value })}
            className="border rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500" />
          <input type="number" step="0.01" placeholder="Credit limit"
            value={cardForm.credit_limit}
            onChange={(e) => setCardForm({ ...cardForm, credit_limit: e.target.value })}
            className="border rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500" />
          <input type="number" min="1" max="31" placeholder="Statement date (day)"
            value={cardForm.statement_date}
            onChange={(e) => setCardForm({ ...cardForm, statement_date: e.target.value })}
            className="border rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500" />
        </div>
        <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700">Add Card</button>
      </form>

      {/* Cards List */}
      {loading ? <p className="text-gray-500">Loading...</p> : (
        <div className="space-y-4">
          {cards.map((card) => (
            <div key={card.id} className="bg-white rounded-lg shadow p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-semibold">{card.name}</h3>
                  <p className="text-sm text-gray-500">
                    APR: {(parseFloat(card.standard_apr || 0) * 100).toFixed(1)}% |
                    Min: {(parseFloat(card.min_percentage || 0) * 100).toFixed(0)}% or {'\u00a3'}{parseFloat(card.min_floor || 0).toFixed(0)} |
                    Limit: {'\u00a3'}{parseFloat(card.credit_limit || 0).toFixed(0)} |
                    Statement: {card.statement_date}th
                  </p>
                </div>
                <button onClick={() => dispatch(removeCard(card.id))}
                  className="text-red-600 hover:text-red-900 text-sm">Delete</button>
              </div>

              {/* Buckets */}
              <div className="ml-4 space-y-2">
                <h4 className="text-sm font-medium text-gray-600">Buckets</h4>
                {(card.buckets || []).map((b) => (
                  <div key={b.id} className="flex justify-between items-center py-1 border-b text-sm">
                    <span>
                      <span className="font-medium">{b.bucket_name}</span>
                      <span className="ml-2 text-gray-500">({b.bucket_type})</span>
                      {b.promo_end_date && <span className="ml-2 text-orange-500">Promo ends: {b.promo_end_date}</span>}
                    </span>
                    <span className="flex items-center gap-4">
                      <span className="font-mono">{'\u00a3'}{parseFloat(b.current_balance || 0).toFixed(2)}</span>
                      <span className="text-gray-500">APR: {(parseFloat(b.promo_apr || 0) * 100).toFixed(1)}%</span>
                      <button onClick={() => dispatch(removeBucket({ id: b.id, cardId: card.id }))}
                        className="text-red-500 hover:text-red-700">x</button>
                    </span>
                  </div>
                ))}

                {showBucketForm === card.id ? (
                  <form onSubmit={(e) => handleAddBucket(e, card.id)} className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-2">
                    <input type="text" placeholder="Bucket name" value={bucketForm.bucket_name}
                      onChange={(e) => setBucketForm({ ...bucketForm, bucket_name: e.target.value })}
                      className="border rounded px-2 py-1 text-sm" required />
                    <select value={bucketForm.bucket_type}
                      onChange={(e) => setBucketForm({ ...bucketForm, bucket_type: e.target.value })}
                      className="border rounded px-2 py-1 text-sm">
                      <option value="purchases">Purchases</option>
                      <option value="transfer">Balance Transfer</option>
                    </select>
                    <input type="number" step="0.01" placeholder="Balance"
                      value={bucketForm.current_balance}
                      onChange={(e) => setBucketForm({ ...bucketForm, current_balance: e.target.value })}
                      className="border rounded px-2 py-1 text-sm" required />
                    <input type="number" step="0.001" placeholder="Promo APR"
                      value={bucketForm.promo_apr}
                      onChange={(e) => setBucketForm({ ...bucketForm, promo_apr: e.target.value })}
                      className="border rounded px-2 py-1 text-sm" />
                    <input type="date" placeholder="Promo end date"
                      value={bucketForm.promo_end_date}
                      onChange={(e) => setBucketForm({ ...bucketForm, promo_end_date: e.target.value })}
                      className="border rounded px-2 py-1 text-sm" />
                    <button type="submit" className="bg-green-600 text-white px-3 py-1 rounded text-sm">Save</button>
                    <button type="button" onClick={() => setShowBucketForm(null)}
                      className="bg-gray-200 text-gray-700 px-3 py-1 rounded text-sm">Cancel</button>
                  </form>
                ) : (
                  <button onClick={() => setShowBucketForm(card.id)}
                    className="text-indigo-600 hover:text-indigo-800 text-sm mt-1">+ Add Bucket</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
