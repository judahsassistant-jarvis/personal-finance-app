import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Sparkles, Check, X as XIcon, Search, Tag, Plus, ArrowLeftRight } from 'lucide-react';
import {
  fetchTransactions,
  editTransaction,
  bulkRecategorize,
  confirmTransferPair,
  dismissTransferPair,
} from '../store/transactionsSlice.js';
import { fetchDebts } from '../store/debtsSlice.js';
import { fetchAccounts } from '../store/accountsSlice.js';
import { fetchRecurringBills, removeRecurringBill } from '../store/recurringBillsSlice.js';
import { fetchCategoryRules, addCategoryRule } from '../store/categoryRulesSlice.js';
import { updateProfile } from '../store/authSlice.js';
import { suggestTagsForUntagged } from '../services/debtPaymentMatcher.js';
import { findMatchingRecurringBill } from '../services/recurringBills.js';
import { findTransferPairs, indexPairsByTransaction } from '../services/transferPairing.js';
import { KNOWN_CATEGORIES } from '../services/csvParser.js';
import { formatGBP } from '../firebase/schema.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Input } from '../components/ui/input.jsx';

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
  const profile = useSelector((s) => s.auth.profile);
  const loading = useSelector((s) => s.transactions.loading);

  const [filter, setFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [accountFilter, setAccountFilter] = useState('all');
  const [showManageCategories, setShowManageCategories] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');

  const customCategories = profile?.custom_categories ?? [];
  const allCategories = useMemo(() => {
    const merged = new Set([...KNOWN_CATEGORIES, ...customCategories]);
    return [...merged].sort((a, b) => a.localeCompare(b));
  }, [customCategories]);

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

  const transferPairs = useMemo(() => findTransferPairs(transactions), [transactions]);
  const pairIndex = useMemo(() => indexPairsByTransaction(transferPairs), [transferPairs]);

  const debtById = useMemo(
    () => new Map(debts.map((d) => [d.id, d])),
    [debts],
  );
  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );

  const filtered = useMemo(() => {
    let rows = filterRows(transactions, filter, suggestions, pairIndex);
    rows = applyFilterControls(rows, {
      searchText, dateFrom, dateTo, minAmount, maxAmount, accountFilter,
    });
    return rows.slice().sort(byDateDesc);
  }, [transactions, filter, suggestions, pairIndex, searchText, dateFrom, dateTo, minAmount, maxAmount, accountFilter]);

  const counts = useMemo(() => ({
    all: transactions.length,
    untagged: transactions.filter((t) => !t.debt_id && Number(t.amount_pennies) < 0).length,
    // Suggestions count includes both debt-payment matches and transfer-pair
    // candidates. Transfer pairs surface twice in pairIndex (once per side) —
    // count them once via the deduped pair list.
    suggestions: transactions.filter((t) => suggestions.has(t.id)).length + transferPairs.length,
    'debt-payments': transactions.filter((t) => t.debt_id).length,
  }), [transactions, suggestions, transferPairs]);

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

  const handleAddCategory = async () => {
    const name = newCategoryInput.trim();
    if (!name) return;
    if (allCategories.some((c) => c.toLowerCase() === name.toLowerCase())) {
      setNewCategoryInput('');
      return; // already exists (built-in or custom) — silent no-op
    }
    const next = [...customCategories, name];
    await dispatch(updateProfile({ custom_categories: next })).unwrap();
    setNewCategoryInput('');
  };

  const handleRemoveCategory = async (name) => {
    if (!window.confirm(`Remove custom category "${name}"? Transactions tagged with it will fall back to "Other".`)) return;
    const next = customCategories.filter((c) => c !== name);
    await dispatch(updateProfile({ custom_categories: next })).unwrap();
  };

  const handleConfirmPair = async (pair) => {
    await dispatch(confirmTransferPair({
      outflowId: pair.outflowId,
      inflowId: pair.inflowId,
    })).unwrap();
  };

  const handleDismissPair = async (pair) => {
    await dispatch(dismissTransferPair({
      outflowId: pair.outflowId,
      inflowId: pair.inflowId,
    })).unwrap();
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

      <FilterControls
        searchText={searchText}
        setSearchText={setSearchText}
        dateFrom={dateFrom}
        setDateFrom={setDateFrom}
        dateTo={dateTo}
        setDateTo={setDateTo}
        minAmount={minAmount}
        setMinAmount={setMinAmount}
        maxAmount={maxAmount}
        setMaxAmount={setMaxAmount}
        accountFilter={accountFilter}
        setAccountFilter={setAccountFilter}
        accounts={accounts}
        showManageCategories={showManageCategories}
        setShowManageCategories={setShowManageCategories}
        filteredCount={filtered.length}
        totalCount={transactions.length}
      />

      {showManageCategories && (
        <ManageCategoriesPanel
          builtIns={KNOWN_CATEGORIES}
          customs={customCategories}
          newCategoryInput={newCategoryInput}
          setNewCategoryInput={setNewCategoryInput}
          onAdd={handleAddCategory}
          onRemove={handleRemoveCategory}
        />
      )}

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
                      pairInfo={pairIndex.get(t.id)}
                      debtById={debtById}
                      accountById={accountById}
                      debts={debts}
                      categories={allCategories}
                      onTag={handleTag}
                      onRecategorize={handleRecategorize}
                      onConfirmPair={handleConfirmPair}
                      onDismissPair={handleDismissPair}
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

function TransactionRow({
  tx, suggestion, pairInfo, debtById, accountById, debts, categories,
  onTag, onRecategorize, onConfirmPair, onDismissPair,
}) {
  const amount = Number(tx.amount_pennies || 0);
  const isInflow = amount > 0;
  const tagged = tx.debt_id;
  const taggedDebt = tagged ? debtById.get(tx.debt_id) : null;
  const suggestedDebt = suggestion ? debtById.get(suggestion) : null;
  const account = tx.account_id ? accountById.get(tx.account_id) : null;
  const isPaired = !!tx.transfer_pair_id;
  const otherAccount = pairInfo ? accountById.get(pairInfo.otherAccountId) : null;

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
        ) : isPaired ? (
          <Badge variant="accent">Transfer</Badge>
        ) : (
          <CategoryPicker
            value={tx.category || 'Other'}
            onChange={(c) => onRecategorize(tx, c)}
            categories={categories}
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
        ) : isPaired ? (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <ArrowLeftRight className="w-3 h-3" />
            Paired
          </span>
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
        ) : pairInfo ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <ArrowLeftRight className="w-3 h-3 text-accent-foreground" />
              {pairInfo.role === 'outflow' ? 'Transfer to ' : 'Transfer from '}
              <span className="font-medium text-foreground">
                {otherAccount?.name ?? 'another account'}
              </span>?
            </span>
            <Button
              variant="outline" size="sm"
              onClick={() => onConfirmPair(pairInfo.pair)}
              title="Confirm transfer pair"
              className="h-6 px-2 text-xs"
            >
              <Check className="w-3 h-3" />Pair
            </Button>
            <Button
              variant="ghost" size="sm"
              onClick={() => onDismissPair(pairInfo.pair)}
              title="Dismiss — not a transfer"
              className="h-6 px-2 text-xs"
            >
              <XIcon className="w-3 h-3" />
            </Button>
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

function FilterControls({
  searchText, setSearchText,
  dateFrom, setDateFrom,
  dateTo, setDateTo,
  minAmount, setMinAmount,
  maxAmount, setMaxAmount,
  accountFilter, setAccountFilter,
  accounts,
  showManageCategories, setShowManageCategories,
  filteredCount, totalCount,
}) {
  const hasFilters =
    searchText || dateFrom || dateTo || minAmount !== '' || maxAmount !== '' || accountFilter !== 'all';

  function clearAll() {
    setSearchText('');
    setDateFrom('');
    setDateTo('');
    setMinAmount('');
    setMaxAmount('');
    setAccountFilter('all');
  }

  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto_auto_auto] gap-2 items-center">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search merchant, description, category…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="pl-8 h-8"
            />
          </div>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 text-xs w-36"
            title="From date"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 text-xs w-36"
            title="To date"
          />
          <Input
            type="number"
            inputMode="decimal"
            placeholder="Min £"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            className="h-8 text-xs w-24"
            step="0.01"
            min="0"
          />
          <Input
            type="number"
            inputMode="decimal"
            placeholder="Max £"
            value={maxAmount}
            onChange={(e) => setMaxAmount(e.target.value)}
            className="h-8 text-xs w-24"
            step="0.01"
            min="0"
          />
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            title="Account"
          >
            <option value="all">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground flex-wrap">
          <span>
            Showing <span className="font-medium text-foreground">{filteredCount}</span> of {totalCount} transactions
          </span>
          <div className="flex items-center gap-2">
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearAll} className="h-7 text-xs">
                Clear filters
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowManageCategories((v) => !v)}
              className="h-7 text-xs"
            >
              <Tag className="w-3 h-3 mr-1" />
              {showManageCategories ? 'Hide categories' : 'Manage categories'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ManageCategoriesPanel({ builtIns, customs, newCategoryInput, setNewCategoryInput, onAdd, onRemove }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Categories</CardTitle>
        <CardDescription>
          Built-in categories are read-only. Custom categories appear in the dropdown alongside the built-ins
          and persist to your profile — they're available across all your devices.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Built-in</div>
          <div className="flex flex-wrap gap-1.5">
            {builtIns.map((c) => (
              <Badge key={c} variant="secondary" className="text-xs">{c}</Badge>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Custom</div>
          {customs.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet — add one below.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {customs.map((c) => (
                <Badge key={c} variant="default" className="text-xs flex items-center gap-1">
                  {c}
                  <button
                    type="button"
                    onClick={() => onRemove(c)}
                    title={`Remove "${c}"`}
                    className="-mr-1 ml-0.5 opacity-60 hover:opacity-100"
                  >
                    <XIcon className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); onAdd(); }}
          className="flex gap-2 items-center"
        >
          <Input
            placeholder="New category name"
            value={newCategoryInput}
            onChange={(e) => setNewCategoryInput(e.target.value)}
            className="h-8 max-w-xs"
            maxLength={30}
          />
          <Button type="submit" size="sm" variant="accent" disabled={!newCategoryInput.trim()}>
            <Plus className="w-3 h-3 mr-1" />Add
          </Button>
        </form>
      </CardContent>
    </Card>
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

function CategoryPicker({ value, onChange, categories }) {
  // Falls through to "Other" if the stored value isn't in the active list
  // (e.g. a custom category was deleted while transactions still reference it,
  // or legacy data with a deprecated name). Surfacing as "Other" rather than
  // blank avoids silently breaking the dropdown.
  const known = categories.includes(value) ? value : 'Other';
  return (
    <select
      value={known}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground hover:text-foreground"
      title="Recategorise"
    >
      {categories.map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
    </select>
  );
}

function filterRows(transactions, filter, suggestions, pairIndex) {
  switch (filter) {
    case 'untagged':
      return transactions.filter((t) => !t.debt_id && Number(t.amount_pennies) < 0);
    case 'suggestions':
      return transactions.filter((t) => suggestions.has(t.id) || pairIndex.has(t.id));
    case 'debt-payments':
      return transactions.filter((t) => t.debt_id);
    default:
      return transactions;
  }
}

/**
 * Layer the search-box + date / amount / account filter controls on top of
 * the tab-level filter. Each control is opt-in; blank values mean "no filter."
 */
function applyFilterControls(rows, { searchText, dateFrom, dateTo, minAmount, maxAmount, accountFilter }) {
  let out = rows;

  const q = searchText.trim().toLowerCase();
  if (q) {
    out = out.filter((t) => {
      const merchant = (t.merchant || '').toLowerCase();
      const description = (t.description || '').toLowerCase();
      const category = (t.category || '').toLowerCase();
      return merchant.includes(q) || description.includes(q) || category.includes(q);
    });
  }

  const fromMs = dateFrom ? new Date(dateFrom).getTime() : null;
  const toMs = dateTo ? new Date(dateTo).getTime() + 86_400_000 - 1 : null; // inclusive end-of-day
  if (fromMs != null || toMs != null) {
    out = out.filter((t) => {
      const ms = toMillis(t.date);
      if (fromMs != null && ms < fromMs) return false;
      if (toMs != null && ms > toMs) return false;
      return true;
    });
  }

  // Amount range filters use absolute pennies — easier to reason about than
  // signed values when the user types a range like "10 to 50."
  const minP = minAmount === '' ? null : Math.round(Number(minAmount) * 100);
  const maxP = maxAmount === '' ? null : Math.round(Number(maxAmount) * 100);
  if (Number.isFinite(minP) || Number.isFinite(maxP)) {
    out = out.filter((t) => {
      const abs = Math.abs(Number(t.amount_pennies || 0));
      if (Number.isFinite(minP) && abs < minP) return false;
      if (Number.isFinite(maxP) && abs > maxP) return false;
      return true;
    });
  }

  if (accountFilter && accountFilter !== 'all') {
    out = out.filter((t) => t.account_id === accountFilter);
  }

  return out;
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
