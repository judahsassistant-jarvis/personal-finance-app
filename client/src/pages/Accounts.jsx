import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Wallet, PiggyBank, Landmark, TrendingUp, Lock, Plus, Pencil, Trash2 } from 'lucide-react';
import { fetchAccounts, editAccount, removeAccount } from '../store/accountsSlice.js';
import { ACCOUNT_SUBTYPES, LIQUIDITY, formatGBP } from '../firebase/schema.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Separator } from '../components/ui/separator.jsx';
import AccountForm from '../components/accounts/AccountForm.jsx';

const SUBTYPE_META = {
  [ACCOUNT_SUBTYPES.CURRENT]: { label: 'Current', icon: Wallet },
  [ACCOUNT_SUBTYPES.SAVINGS]: { label: 'Savings', icon: PiggyBank },
  [ACCOUNT_SUBTYPES.CASH_ISA]: { label: 'Cash ISA', icon: PiggyBank },
  [ACCOUNT_SUBTYPES.SS_ISA]: { label: 'Stocks & Shares ISA', icon: TrendingUp },
  [ACCOUNT_SUBTYPES.SIPP]: { label: 'SIPP', icon: Lock },
  [ACCOUNT_SUBTYPES.INVESTMENT]: { label: 'Investment', icon: TrendingUp },
  [ACCOUNT_SUBTYPES.PENSION]: { label: 'Pension', icon: Lock },
};

export default function Accounts() {
  const dispatch = useDispatch();
  const accounts = useSelector((s) => s.accounts.items);
  const loading = useSelector((s) => s.accounts.loading);

  const [form, setForm] = useState(null); // null | 'add' | { mode: 'edit', account }

  useEffect(() => {
    dispatch(fetchAccounts());
  }, [dispatch]);

  const grouped = useMemo(() => {
    const liquid = [];
    const locked = [];
    for (const a of accounts) {
      (a.liquidity === LIQUIDITY.LIQUID ? liquid : locked).push(a);
    }
    return { liquid, locked };
  }, [accounts]);

  const includedTotal = useMemo(
    () => accounts
      .filter((a) => a.include_in_safe_to_spend === true)
      .reduce((s, a) => s + Number(a.balance_pennies || 0), 0),
    [accounts],
  );

  const handleToggle = async (account) => {
    await dispatch(editAccount({
      id: account.id,
      include_in_safe_to_spend: !account.include_in_safe_to_spend,
    })).unwrap();
  };

  const handleDelete = async (account) => {
    if (!window.confirm(`Delete "${account.name}"? This cannot be undone.`)) return;
    await dispatch(removeAccount(account.id)).unwrap();
  };

  if (loading && accounts.length === 0 && !form) {
    return <p className="text-muted-foreground">Loading accounts…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {accounts.length} account{accounts.length === 1 ? '' : 's'} ·
            {' '}<span className="font-medium text-foreground">{formatGBP(includedTotal)}</span> counted toward safe-to-spend
          </p>
        </div>
        {!form && (
          <Button onClick={() => setForm('add')}>
            <Plus className="w-4 h-4" />Add account
          </Button>
        )}
      </div>

      {form && (
        <AccountForm mode={form} onClose={() => setForm(null)} />
      )}

      {accounts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Safe-to-spend inclusion</CardTitle>
            <CardDescription>
              Only accounts you opt in here contribute to Dashboard safe-to-spend and the Debt Planner&apos;s
              auto-suggested budget. Current accounts default in; savings, ISAs, and pensions default out
              so long-term holdings don&apos;t silently inflate your day-to-day budget. Toggle any account
              on if you actively treat it as spending money (e.g. using savings to pay off higher-APR debt).
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {grouped.liquid.length > 0 && (
        <AccountGroup
          title="Liquid"
          description="Current, savings, and cash ISA"
          accounts={grouped.liquid}
          onToggle={handleToggle}
          onEdit={(a) => setForm({ mode: 'edit', account: a })}
          onDelete={handleDelete}
        />
      )}
      {grouped.locked.length > 0 && (
        <AccountGroup
          title="Locked"
          description="Investments and pensions — forecast projections use growth rates, not cash flow"
          accounts={grouped.locked}
          onToggle={handleToggle}
          onEdit={(a) => setForm({ mode: 'edit', account: a })}
          onDelete={handleDelete}
        />
      )}

      {accounts.length === 0 && !form && (
        <Card>
          <CardHeader>
            <CardTitle>No accounts yet</CardTitle>
            <CardDescription>
              Hit <b>Add account</b> above to start, or seed your emulator with <code>npm run seed</code>.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}

function AccountGroup({ title, description, accounts, onToggle, onEdit, onDelete }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <CardTitle>{title}</CardTitle>
          <Badge variant="muted">{accounts.length}</Badge>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 -my-3">
        {accounts.map((account, i) => (
          <div key={account.id}>
            {i > 0 && <Separator />}
            <AccountRow
              account={account}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AccountRow({ account, onToggle, onEdit, onDelete }) {
  const meta = SUBTYPE_META[account.subtype] || { label: account.subtype, icon: Wallet };
  const Icon = meta.icon;
  const included = account.include_in_safe_to_spend === true;

  const rate = account.interest_rate ?? account.growth_rate ?? null;
  const contribution = account.monthly_contribution_pennies ?? 0;

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{account.name}</div>
          <div className="text-xs text-muted-foreground">
            {meta.label}
            {rate != null && ` · ${(rate * 100).toFixed(2)}%`}
            {contribution > 0 && ` · ${formatGBP(contribution)}/mo in`}
            {account.subtype === ACCOUNT_SUBTYPES.SIPP && account.sipp_age && ` · unlocks at ${account.sipp_age}`}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono tabular-nums text-sm">{formatGBP(account.balance_pennies || 0)}</span>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={included}
            onChange={() => onToggle(account)}
            className="h-4 w-4 rounded border-input"
            aria-label={`Include ${account.name} in safe-to-spend`}
          />
          <span className={included ? 'text-foreground' : 'text-muted-foreground'}>
            {included ? 'Included' : 'Excluded'}
          </span>
        </label>
        <Button variant="ghost" size="sm" onClick={() => onEdit(account)} aria-label={`Edit ${account.name}`}>
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onDelete(account)} aria-label={`Delete ${account.name}`}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
