import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Sparkles, Check, X as XIcon } from 'lucide-react';
import { fetchTransactions, editTransaction, bulkRecategorize } from '../store/transactionsSlice.js';
import { fetchDebts } from '../store/debtsSlice.js';
import { fetchAccounts } from '../store/accountsSlice.js';
import { fetchRecurringBills, removeRecurringBill } from '../store/recurringBillsSlice.js';
import { fetchCategoryRules, addCategoryRule } from '../store/categoryRulesSlice.js';
import { suggestTagsForUntagged } from '../services/debtPaymentMatcher.js';
import { findMatchingRecurringBill } from '../services/recurringBills.js';
import { KNOWN_CATEGORIES } from '../services/csvParser.js';
import { formatGBP } from '../firebase/schema.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'untagged', label: 'Untagged outflows' },
  { key: 'suggestions', label: 'Suggestions' },
  { key: 'debt-payments', label: 'Debt payments' },
];

export default function Transactions() {
  const dispatch = useDispatch();
  const transactions = useSelector((s) => s.transactions.items);
  const debts = useSelector((s) => s.debts.items);
  const accounts = useSelector((s) => s.accounts.items);
  const recurringBills = useSelector((s) => s.recurringBills.items);
  const loading = useSelector((s) => s.transactions.loading);

  const [filter, setFilter] = useState('all');

  useEffect(() => {
    dispatch(fetchTransactions());
    dispatch(fetchDebts());
    dispatch(fetchAccounts());
    dispatch(fetchRecurringBills());
    dispatch(fetchCategoryRules());
  }, [dispatch]);

  const suggestions = useMemo(
    () => suggestTagsForUntagged(transactions, debts),
    [transactions, debts],
  );

  const debtById = useMemo(
    () => new Map(debts.map((d) => [d.id, d])),
    [debts],
  );
  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );

  const filtered = useMemo(() => {
    const rows = filterRows(transactions, filter, suggestions);
    return rows.slice().sort(byDateDesc);
  }, [transactions, filter, suggestions]);

  const counts = useMemo(() => ({
    all: transactions.length,
    untagged: transactions.filter((t) => !t.debt_id && Number(t.amount_pennies) < 0).length,
    suggestions: transactions.filter((t) => suggestions.has(t.id)).length,
    'debt-payments': transactions.filter((t) => t.debt_id).length,
  }), [transactions, suggestions]);

  const handleRecategorize = async (tx, category) => {
    if (!category || category === tx.category) return;
    // Always update the row that was clicked.
    await dispatch(editTransaction({ id: tx.id, category })).unwrap();

    // Find sibling transactions (same merchant, NOT debt-tagged, NOT this same
    // row, currently in a different category). If there are any, offer to
    // re-categorise them all + save a persistent rule for future imports.
    const merchantKey = (tx.merchant || '').toLowerCase().trim();
    if (!merchantKey) return;

    const siblings = transactions.filter(
      (t) =>
        t.id !== tx.id
        && !t.debt_id
        && (t.merchant || '').toLowerCase().trim() === merchantKey
        && t.category !== category,
    );

    const wantsBulkAndRule = siblings.length > 0
      ? window.confirm(
          `Apply "${category}" to ${siblings.length} other "${tx.merchant}" transaction${siblings.length === 1 ? '' : 's'} `
          + 'AND save as a rule so future imports auto-categorise this merchant?\n\n'
          + 'Cancel = update only this row.',
        )
      : window.confirm(
          `Save "${category}" as a rule for "${tx.merchant}" so future imports auto-categorise this merchant?\n\n`
          + 'Cancel = update only this row.',
        );

    if (!wantsBulkAndRule) return;

    if (siblings.length > 0) {
      await dispatch(bulkRecategorize({
        ids: siblings.map((s) => s.id),
        category,
      })).unwrap();
    }
    await dispatch(addCategoryRule({ merchant: tx.merchant, category })).unwrap();
  };

  const handleTag = async (tx, debtId) => {
    await dispatch(editTransaction({
      id: tx.id,
      debt_id: debtId ?? null,
      category: debtId ? 'Debt Payment' : tx.category,
    })).unwrap();

    // Cascade: if tagging just moved an outflow from "bill" territory into
    // "debt payment" territory, there may still be a recurring_bills row for
    // the same merchant (auto-inferred before tagging). Offer to remove it,
    // per §3.7's single-source-of-truth rule. Only prompts when the merchant
    // actually matches an existing bill — silent otherwise.
    if (debtId) {
      const matchingBill = findMatchingRecurringBill(tx.merchant, recurringBills);
      if (matchingBill) {
        const debt = debtById.get(debtId);
        const confirmed = window.confirm(
          `"${tx.merchant}" is also tracked as a recurring bill (${matchingBill.category || 'Bills'}). ` +
          `It's now tagged under ${debt?.name ?? 'this debt'}, so keeping the bill row would ` +
          'double-count it in your safe-to-spend.\n\nRemove the recurring bill?'
        );
        if (confirmed) {
          await dispatch(removeRecurringBill(matchingBill.id)).unwrap();
        }
      }
    }
  };

  if (loading && transactions.length === 0) {
    return <p className="text-muted-foreground">Loading transactions…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {transactions.length} transaction{transactions.length === 1 ? '' : 's'} ·
          {' '}<span className="font-medium text-foreground">{counts['debt-payments']}</span> tagged as debt payment
          {suggestions.size > 0 && (
            <>
              {' · '}
              <span className="text-foreground font-medium">{suggestions.size}</span> suggestion{suggestions.size === 1 ? '' : 's'} pending
            </>
          )}
        </p>
      </div>

      <div className="flex items-center gap-1 rounded-md bg-muted p-1 w-fit flex-wrap">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? 'default' : 'ghost'}
            onClick={() => setFilter(f.key)}
            className="h-7 text-xs"
          >
            {f.label}
            {counts[f.key] > 0 && (
              <span className="ml-1.5 text-muted-foreground">({counts[f.key]})</span>
            )}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No transactions match this filter</CardTitle>
            <CardDescription>
              {filter === 'untagged' && 'All outflows are either tagged as debt payments or in other categories.'}
              {filter === 'suggestions' && 'Nothing to suggest right now — every match has been confirmed or dismissed.'}
              {filter === 'debt-payments' && 'No transactions have been tagged to a debt yet. Use the "Suggestions" filter to start.'}
              {filter === 'all' && 'Import or add some transactions first.'}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase tracking-wide bg-muted/50">
                  <tr>
                    <th className="text-left py-2 px-3 font-medium">Date</th>
                    <th className="text-left py-2 px-3 font-medium">Merchant</th>
                    <th className="text-left py-2 px-3 font-medium">Category</th>
                    <th className="text-right py-2 px-3 font-medium">Amount</th>
                    <th className="text-left py-2 px-3 font-medium">Tagged to</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <TransactionRow
                      key={t.id}
                      tx={t}
                      suggestion={suggestions.get(t.id)}
                      debtById={debtById}
                      accountById={accountById}
                      debts={debts}
                      onTag={handleTag}
                      onRecategorize={handleRecategorize}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TransactionRow({ tx, suggestion, debtById, accountById, debts, onTag, onRecategorize }) {
  const amount = Number(tx.amount_pennies || 0);
  const isInflow = amount > 0;
  const tagged = tx.debt_id;
  const taggedDebt = tagged ? debtById.get(tx.debt_id) : null;
  const suggestedDebt = suggestion ? debtById.get(suggestion) : null;
  const account = tx.account_id ? accountById.get(tx.account_id) : null;

  return (
    <tr className="border-t border-border hover:bg-muted/30">
      <td className="py-2 px-3 tabular-nums text-xs whitespace-nowrap">
        {formatDate(tx.date)}
      </td>
      <td className="py-2 px-3">
        <div className="font-medium">{tx.merchant || '(no merchant)'}</div>
        {account && <div className="text-xs text-muted-foreground">{account.name}</div>}
      </td>
      <td className="py-2 px-3 text-xs">
        {tagged ? (
          <Badge variant="accent">Debt Payment</Badge>
        ) : (
          <CategoryPicker
            value={tx.category || 'Other'}
            onChange={(c) => onRecategorize(tx, c)}
          />
        )}
      </td>
      <td className={`py-2 px-3 text-right tabular-nums font-mono ${isInflow ? 'text-positive' : ''}`}>
        {formatGBP(Math.abs(amount))}
        {isInflow && <span className="text-xs text-muted-foreground ml-1">in</span>}
      </td>
      <td className="py-2 px-3">
        {taggedDebt ? (
          <div className="flex items-center gap-2">
            <span className="text-xs">{taggedDebt.name}</span>
            <Button
              variant="ghost" size="icon"
              onClick={() => onTag(tx, null)}
              title="Untag"
              className="h-6 w-6"
            >
              <XIcon className="w-3 h-3" />
            </Button>
          </div>
        ) : suggestedDebt ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-accent-foreground" />
              Looks like <span className="font-medium text-foreground">{suggestedDebt.name}</span>?
            </span>
            <Button
              variant="outline" size="sm"
              onClick={() => onTag(tx, suggestedDebt.id)}
              title="Confirm tag"
              className="h-6 px-2 text-xs"
            >
              <Check className="w-3 h-3" />Tag
            </Button>
            <DebtPicker
              debts={debts}
              value=""
              onChange={(id) => onTag(tx, id)}
              placeholder="Other…"
            />
          </div>
        ) : !isInflow ? (
          <DebtPicker
            debts={debts}
            value=""
            onChange={(id) => onTag(tx, id)}
            placeholder="Tag to debt…"
          />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

function DebtPicker({ debts, value, onChange, placeholder }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value || null)}
      className="h-7 rounded-md border border-input bg-background px-2 text-xs"
    >
      <option value="">{placeholder}</option>
      {debts.map((d) => (
        <option key={d.id} value={d.id}>{d.name}</option>
      ))}
    </select>
  );
}

function CategoryPicker({ value, onChange }) {
  // Falls through to "Other" if the stored value isn't in the known list
  // (e.g. legacy data with a deprecated category name) — surfacing it as
  // "Other" rather than blank avoids silently breaking the dropdown.
  const known = KNOWN_CATEGORIES.includes(value) ? value : 'Other';
  return (
    <select
      value={known}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground hover:text-foreground"
      title="Recategorise"
    >
      {KNOWN_CATEGORIES.map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
    </select>
  );
}

function filterRows(transactions, filter, suggestions) {
  switch (filter) {
    case 'untagged':
      return transactions.filter((t) => !t.debt_id && Number(t.amount_pennies) < 0);
    case 'suggestions':
      return transactions.filter((t) => suggestions.has(t.id));
    case 'debt-payments':
      return transactions.filter((t) => t.debt_id);
    default:
      return transactions;
  }
}

function byDateDesc(a, b) {
  const ta = toMillis(a.date);
  const tb = toMillis(b.date);
  return tb - ta;
}

function toMillis(d) {
  if (!d) return 0;
  // serializeDoc converts Firestore Timestamps to epoch millis, so this is
  // the usual shape after fetch. Check first.
  if (typeof d === 'number') return Number.isFinite(d) ? d : 0;
  if (d instanceof Date) return d.getTime();
  if (typeof d === 'string') return new Date(d).getTime();
  if (typeof d.toDate === 'function') return d.toDate().getTime();
  if (typeof d.seconds === 'number') return d.seconds * 1000;
  return 0;
}

function formatDate(d) {
  const ms = toMillis(d);
  if (!ms) return '—';
  const date = new Date(ms);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}
