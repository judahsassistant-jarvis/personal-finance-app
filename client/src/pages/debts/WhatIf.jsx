import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchDebts } from '../../store/debtsSlice.js';
import { fetchBuckets } from '../../store/cardBucketsSlice.js';
import { Card, CardHeader, CardTitle, CardDescription } from '../../components/ui/card.jsx';
import WhatIfScenarioCard from '../../components/debts/WhatIfScenarioCard.jsx';

export default function WhatIf() {
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
            Add debts on the Overview tab before modelling a balance transfer scenario.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">What-If: Balance Transfer</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Model moving a card balance (or several) onto a new BT card with a promo rate
          and fee. See whether the interest you'd save outweighs the transfer fee.
        </p>
      </div>
      <WhatIfScenarioCard debts={debts} buckets={buckets} />
    </div>
  );
}
