import { useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Wallet, PiggyBank, Landmark, TrendingUp, Lock } from 'lucide-react';
import { fetchAccounts, editAccount } from '../store/accountsSlice.js';
import { ACCOUNT_SUBTYPES, LIQUIDITY, formatGBP } from '../firebase/schema.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Separator } from '../components/ui/separator.jsx';

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

  if (loading && accounts.length === 0) {
    return <p className="text-muted-foreground">Loading accounts…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {accounts.length} account{accounts.length === 1 ? '' : 's'} ·
          {' '}<span className="font-medium text-foreground">{formatGBP(includedTotal)}</span> counted toward safe-to-spend
        </p>
      </div>

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

      {grouped.liquid.length > 0 && (
        <AccountGroup
          title="Liquid"
          description="Current, savings, and cash ISA"
          accounts={grouped.liquid}
          onToggle={handleToggle}
        />
      )}
      {grouped.locked.length > 0 && (
        <AccountGroup
          title="Locked"
          description="Investments and pensions — forecast projections use growth rates, not cash flow"
          accounts={grouped.locked}
          onToggle={handleToggle}
        />
      )}

      {accounts.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No accounts yet</CardTitle>
            <CardDescription>
              Seed your emulator (<code>npm run seed</code>) or add accounts once the CRUD UI lands.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}

function AccountGroup({ title, description, accounts, onToggle }) {
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
            <AccountRow account={account} onToggle={onToggle} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AccountRow({ account, onToggle }) {
  const meta = SUBTYPE_META[account.subtype] || { label: account.subtype, icon: Wallet };
  const Icon = meta.icon;
  const included = account.include_in_safe_to_spend === true;

  return (
    <label className="flex items-center justify-between gap-4 py-3 cursor-pointer">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{account.name}</div>
          <div className="text-xs text-muted-foreground">{meta.label}</div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className="font-mono tabular-nums text-sm">{formatGBP(account.balance_pennies || 0)}</span>
        <div className="flex items-center gap-2 text-xs">
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
        </div>
      </div>
    </label>
  );
}
