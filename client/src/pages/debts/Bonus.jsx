import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchDebts } from '../../store/debtsSlice.js';
import { fetchBuckets } from '../../store/cardBucketsSlice.js';
import { Card, CardHeader, CardTitle, CardDescription } from '../../components/ui/card.jsx';
import BonusPaymentCard from '../../components/debts/BonusPaymentCard.jsx';

export default function Bonus() {
  const dispatch = useDispatch();
  const debts = useSelector((s) => s.debts.items);
  const buckets = useSelector((s) => s.cardBuckets.items);
  const loading = useSelector((s) => s.debts.loading);

  useEffect(() => {
    dispatch(fetchDebts());
    dispatch(fetchBuckets());
  }, [dispatch]);

  if (loading && debts.length === 0) {
    return <p className="text-muted-foreground">Loading…</p>;
  }
  if (debts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No debts tracked yet</CardTitle>
          <CardDescription>
            Add debts on the Overview tab before modelling a bonus payment.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Got extra money?</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Model a one-off lump sum payment on top of your monthly budget. See how much
          interest you'd save and how many months sooner you'd be debt-free.
        </p>
      </div>
      <BonusPaymentCard debts={debts} buckets={buckets} />
    </div>
  );
}
