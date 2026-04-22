import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Wallet, Lock, TrendingDown, PiggyBank, CalendarClock, Pencil, AlertTriangle, Check } from 'lucide-react';
import { fetchAccounts } from '../store/accountsSlice.js';
import { fetchDebts } from '../store/debtsSlice.js';
import { fetchBuckets } from '../store/cardBucketsSlice.js';
import { fetchTransactions } from '../store/transactionsSlice.js';
import { fetchRecurringBills } from '../store/recurringBillsSlice.js';
import { fetchBankHolidays } from '../store/systemSlice.js';
import { updateProfile } from '../store/authSlice.js';
import {
  formatGBP, poundsToPennies, penniesToPounds,
  CARD_LIKE_SUBTYPES, LIQUIDITY, DEFAULT_PAY_CYCLE,
} from '../firebase/schema.js';
import { computeDiscretionary } from '../services/discretionary.js';
import { daysRemainingInCycle, getNextPayDay } from '../services/payCycle.js';
import { billStatusInCycle, billDateInCycle } from '../services/recurringBills.js';
import ProgressCard from '../components/debts/ProgressCard.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Separator } from '../components/ui/separator.jsx';
import { Button } from '../components/ui/button.jsx';
import { Input } from '../components/ui/input.jsx';
import { Alert, AlertTitle, AlertDescription } from '../components/ui/alert.jsx';

export default function Dashboard() {
  const dispatch = useDispatch();
  const profile = useSelector((s) => s.auth.profile);
  const accounts = useSelector((s) => s.accounts.items);
  const debts = useSelector((s) => s.debts.items);
  const buckets = useSelector((s) => s.cardBuckets.items);
  const transactions = useSelector((s) => s.transactions.items);
  const bills = useSelector((s) => s.recurringBills.items);
  const bankHolidays = useSelector((s) => s.system.bankHolidays);
  const loading = useSelector((s) =>
    s.accounts.loading || s.debts.loading || s.recurringBills.loading,
  );

  useEffect(() => {
    dispatch(fetchAccounts());
    dispatch(fetchDebts());
    dispatch(fetchBuckets());
    dispatch(fetchTransactions());
    dispatch(fetchRecurringBills());
    dispatch(fetchBankHolidays());
  }, [dispatch]);

  const payCycle = profile?.pay_cycle || DEFAULT_PAY_CYCLE;
  const bufferPennies = Number(profile?.buffer_pennies ?? 0);

  const calc = useMemo(() => {
    if (!profile) return null;
    return computeDiscretionary({
      accounts, debts, bills, transactions,
      payCycle, holidayCache: bankHolidays, bufferPennies,
    });
  }, [accounts, debts, bills, transactions, payCycle, bankHolidays, bufferPennies, profile]);

  const daysToPay = useMemo(() => {
    if (!profile) return null;
    return daysRemainingInCycle(new Date(), payCycle, bankHolidays);
  }, [payCycle, bankHolidays, profile]);

  const nextDepositDate = useMemo(() => {
    if (!profile) return null;
    return getNextPayDay(new Date(), payCycle, bankHolidays);
  }, [payCycle, bankHolidays, profile]);

  if (!profile || (loading && accounts.length === 0)) {
    return <p className="text-muted-foreground">Loading your data…</p>;
  }

  const netWorth =
    accounts.filter((a) => a.liquidity === LIQUIDITY.LIQUID).reduce((s, a) => s + Number(a.balance_pennies || 0), 0)
    + accounts.filter((a) => a.liquidity === LIQUIDITY.LOCKED).reduce((s, a) => s + Number(a.balance_pennies || 0), 0)
    - debts.reduce((s, d) => {
      if (CARD_LIKE_SUBTYPES.has(d.subtype)) {
        return s + buckets.filter((b) => b.debt_id === d.id).reduce((bs, b) => bs + Number(b.balance_pennies || 0), 0);
      }
      return s + Number(d.balance_pennies || 0);
    }, 0);

  const lockedTotal = accounts
    .filter((a) => a.liquidity === LIQUIDITY.LOCKED)
    .reduce((s, a) => s + Number(a.balance_pennies || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            This pay cycle: {formatCycle(calc)} · {daysToPay} day{daysToPay === 1 ? '' : 's'} to payday
          </p>
        </div>
      </div>

      {/* Safe-to-spend hero row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <HeroCard
          icon={<Wallet className="w-4 h-4" />}
          label="Safe to spend"
          value={formatGBP(calc.safe_to_spend_pennies)}
          caption="Liquid + expected income − bills − min debt payments"
          tone={calc.safe_to_spend_pennies >= 0 ? 'positive' : 'destructive'}
          big
        />
        <HeroCard
          icon={<PiggyBank className="w-4 h-4" />}
          label="Discretionary"
          value={formatGBP(calc.discretionary_pennies)}
          caption={`After £${(bufferPennies / 100).toFixed(0)} buffer · auto-allocates to Debt Planner`}
          tone="accent"
        />
        <HeroCard
          icon={<CalendarClock className="w-4 h-4" />}
          label="Days to payday"
          value={String(daysToPay)}
          caption={`Next pay: ${nextDepositDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`}
        />
        <HeroCard
          icon={<TrendingDown className="w-4 h-4" />}
          label="Remaining this cycle"
          value={formatGBP(calc.total_outflows_remaining_pennies)}
          caption={`${calc.bills.pending_count} bill${calc.bills.pending_count === 1 ? '' : 's'} · ${calc.debt_minimums.pending_count} debt min${calc.debt_minimums.pending_count === 1 ? '' : 's'}${calc.bills.missed_count > 0 ? ` · ${calc.bills.missed_count} missed` : ''}`}
          tone={calc.bills.missed_count > 0 ? 'warning' : undefined}
        />
      </div>

      {/* Missed bills alert */}
      {calc.bills.missed_count > 0 && (
        <Alert variant="warning">
          <AlertTriangle className="w-4 h-4" />
          <AlertTitle>
            {calc.bills.missed_count} expected bill{calc.bills.missed_count === 1 ? '' : 's'} unseen this cycle
          </AlertTitle>
          <AlertDescription>
            <span className="font-mono tabular-nums">{formatGBP(calc.bills.missed_pennies)}</span> not yet matched by a transaction. Either the bill hasn’t landed, or it did but the merchant name or amount didn’t match. Check your transactions or edit the bill.
          </AlertDescription>
        </Alert>
      )}

      {/* Upcoming bills in cycle */}
      <Card>
        <CardHeader>
          <CardTitle>Bills this cycle</CardTitle>
          <CardDescription>
            {bills.length === 0
              ? 'No recurring bills set up yet.'
              : `${bills.length} recurring bill${bills.length === 1 ? '' : 's'} tracked`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bills.length === 0 ? (
            <p className="text-sm text-muted-foreground">Recurring bills populate as transactions are imported.</p>
          ) : (
            <div className="-my-3">
              {bills
                .slice()
                .map((bill) => ({
                  bill,
                  dueDate: billDateInCycle(bill, calc.cycle.start, calc.cycle.end),
                  status: billStatusInCycle({
                    bill, transactions,
                    cycleStart: calc.cycle.start,
                    cycleEnd: calc.cycle.end,
                  }),
                }))
                .sort((a, b) => {
                  const ta = a.dueDate ? a.dueDate.getTime() : 0;
                  const tb = b.dueDate ? b.dueDate.getTime() : 0;
                  return ta - tb;
                })
                .map(({ bill, dueDate, status }, i) => (
                  <div key={bill.id}>
                    {i > 0 && <Separator />}
                    <BillRow bill={bill} dueDate={dueDate} status={status} />
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Account + debt summary (unchanged style) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Net worth</CardTitle>
            <CardDescription>Locked £{(lockedTotal / 100).toFixed(0)} · included in net worth, excluded from safe-to-spend</CardDescription>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-mono tabular-nums font-semibold ${netWorth >= 0 ? 'text-positive' : 'text-destructive'}`}>
              {formatGBP(netWorth)}
            </div>
          </CardContent>
        </Card>

        <BufferCard bufferPennies={bufferPennies} onSave={(p) => dispatch(updateProfile({ buffer_pennies: p }))} />
      </div>

      {debts.length > 0 && (
        <ProgressCard debts={debts} buckets={buckets} variant="compact" />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AccountList accounts={accounts} />
        <DebtList debts={debts} buckets={buckets} />
      </div>
    </div>
  );
}

function formatCycle(calc) {
  if (!calc) return '';
  // Display cycle as inclusive end: start is the nominal payday, end-1 is the day before next nominal payday.
  const inclusiveEnd = new Date(calc.cycle.end);
  inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
  const start = calc.cycle.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const end = inclusiveEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${start} → ${end}`;
}

function HeroCard({ icon, label, value, caption, tone, big }) {
  const valueCls = tone === 'destructive'
    ? 'text-destructive'
    : tone === 'positive'
      ? 'text-positive'
      : tone === 'accent'
        ? 'text-accent'
        : tone === 'warning'
          ? 'text-warning-foreground'
          : 'text-foreground';
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <CardDescription className="text-xs uppercase tracking-wide">{label}</CardDescription>
        </div>
        <CardTitle className={`font-mono tabular-nums mt-1 ${big ? 'text-3xl' : 'text-2xl'} font-semibold ${valueCls}`}>
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 -mt-2">
        <p className="text-xs text-muted-foreground">{caption}</p>
      </CardContent>
    </Card>
  );
}

function BillRow({ bill, dueDate, status }) {
  const dueLabel = dueDate
    ? dueDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    : `Day ${bill.expected_day_of_month}`;
  const statusBadge = status === 'paid'
    ? <Badge variant="positive"><Check className="w-3 h-3 mr-1" />Paid</Badge>
    : status === 'missed'
      ? <Badge variant="warning">Missed</Badge>
      : <Badge variant="muted">{dueLabel}</Badge>;
  return (
    <div className="flex items-center justify-between py-3">
      <div className="min-w-0">
        <div className="font-medium text-sm truncate">{bill.merchant}</div>
        <div className="flex items-center gap-1.5 mt-1">
          <Badge variant="muted">{bill.category}</Badge>
          {statusBadge}
        </div>
      </div>
      <span className={`font-mono tabular-nums font-medium ${status === 'paid' ? 'text-muted-foreground line-through' : 'text-destructive'}`}>
        {formatGBP(bill.expected_amount_pennies)}
      </span>
    </div>
  );
}

function BufferCard({ bufferPennies, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(penniesToPounds(bufferPennies).toString());

  useEffect(() => {
    setDraft(penniesToPounds(bufferPennies).toString());
  }, [bufferPennies]);

  const commit = () => {
    const p = poundsToPennies(draft);
    if (Number.isFinite(p) && p >= 0) onSave(p);
    setEditing(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Safe-to-spend buffer</CardTitle>
        <CardDescription>Held back before Debt Planner auto-allocates discretionary</CardDescription>
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">£</span>
            <Input
              type="number"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && commit()}
              className="max-w-[120px]"
            />
            <Button size="sm" onClick={commit}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-2xl font-mono tabular-nums font-semibold">
              {formatGBP(bufferPennies)}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="w-3.5 h-3.5" />Edit
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AccountList({ accounts }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Accounts</CardTitle>
        <CardDescription>{accounts.length} total</CardDescription>
      </CardHeader>
      <CardContent>
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accounts yet.</p>
        ) : (
          <div className="-my-3">
            {accounts.map((a, i) => (
              <div key={a.id}>
                {i > 0 && <Separator />}
                <div className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-medium text-sm">{a.name}</div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Badge variant="muted">{a.subtype}</Badge>
                      <Badge variant={a.liquidity === LIQUIDITY.LIQUID ? 'positive' : 'accent'}>
                        {a.liquidity === LIQUIDITY.LIQUID ? (
                          <><Wallet className="w-3 h-3 mr-1" />liquid</>
                        ) : (
                          <><Lock className="w-3 h-3 mr-1" />locked</>
                        )}
                      </Badge>
                    </div>
                  </div>
                  <span className="font-mono tabular-nums font-medium">{formatGBP(a.balance_pennies || 0)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DebtList({ debts, buckets }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Debts</CardTitle>
        <CardDescription>{debts.length} total</CardDescription>
      </CardHeader>
      <CardContent>
        {debts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No debts tracked.</p>
        ) : (
          <div className="-my-3">
            {debts.map((d, i) => {
              const cardBuckets = buckets.filter((b) => b.debt_id === d.id);
              const balance = CARD_LIKE_SUBTYPES.has(d.subtype)
                ? cardBuckets.reduce((s, b) => s + Number(b.balance_pennies || 0), 0)
                : Number(d.balance_pennies || 0);
              return (
                <div key={d.id}>
                  {i > 0 && <Separator />}
                  <div className="flex items-center justify-between py-3">
                    <div>
                      <div className="font-medium text-sm">{d.name}</div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Badge variant="muted">{d.subtype}</Badge>
                        {d.priority && <Badge variant="warning">priority</Badge>}
                        {d.standard_apr && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {(d.standard_apr * 100).toFixed(1)}% APR
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={`font-mono tabular-nums font-medium ${balance > 0 ? 'text-destructive' : 'text-positive'}`}>
                      {formatGBP(balance)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
