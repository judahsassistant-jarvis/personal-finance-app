import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAccounts } from '../store/accountsSlice';
import { fetchCards } from '../store/cardsSlice';
import { fetchTransactions } from '../store/transactionsSlice';
import {
  getAvailableFunds, calculateForecast, getForecasts, getPayoffSchedule,
  getAvalancheStrategy, getPromoCliffs,
} from '../api/client';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';

export default function Dashboard() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { items: accounts, loading: accLoading } = useSelector((s) => s.accounts);
  const { items: cards, loading: cardsLoading } = useSelector((s) => s.cards);
  const [available, setAvailable] = useState(null);
  const [availLoading, setAvailLoading] = useState(false);
  const [forecastRunning, setForecastRunning] = useState(false);
  const [forecastMsg, setForecastMsg] = useState(null);

  // Forecast data
  const [forecasts, setForecasts] = useState([]);
  const [payoff, setPayoff] = useState([]);
  const [strategy, setStrategy] = useState([]);
  const [cliffs, setCliffs] = useState([]);

  const currentMonth = new Date().toISOString().slice(0, 7) + '-01';

  useEffect(() => {
    dispatch(fetchAccounts());
    dispatch(fetchCards());
    dispatch(fetchTransactions({ limit: 1 }));
  }, [dispatch]);

  useEffect(() => {
    async function loadAll() {
      setAvailLoading(true);
      try {
        const [avRes, fRes, pRes, sRes, cRes] = await Promise.all([
          getAvailableFunds(currentMonth),
          getForecasts(),
          getPayoffSchedule(),
          getAvalancheStrategy(),
          getPromoCliffs(12),
        ]);
        setAvailable(avRes.data);
        setForecasts(fRes.data);
        setPayoff(pRes.data);
        setStrategy(sRes.data.cards || []);
        setCliffs(cRes.data.cliffs || []);
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      }
      setAvailLoading(false);
    }
    loadAll();
  }, []);

  const totalBalance = accounts.reduce((s, a) => s + parseFloat(a.balance || 0), 0);
  const totalDebt = cards.reduce((s, c) => {
    const bucketDebt = (c.buckets || []).reduce((bs, b) => bs + parseFloat(b.current_balance || 0), 0);
    return s + bucketDebt;
  }, 0);

  // Build 12-month projection chart data
  const chartData = [];
  const monthMap = {};
  for (const f of forecasts) {
    if (!monthMap[f.month]) monthMap[f.month] = { month: f.month.slice(0, 7) };
    if (f.card_id && f.card?.name) {
      monthMap[f.month][f.card.name] = parseFloat(f.card_ending_balance || 0);
    }
    if (!f.card_id && f.total_ending_debt != null) {
      monthMap[f.month].totalDebt = parseFloat(f.total_ending_debt);
    }
    if (f.has_cliff) monthMap[f.month].hasCliff = true;
  }
  Object.keys(monthMap).sort().forEach((k) => chartData.push(monthMap[k]));

  const cardNames = [...new Set(forecasts.filter((f) => f.card?.name).map((f) => f.card.name))];
  const colors = ['#6366f1', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

  // Debt free date
  const debtFreeDate = forecasts.find((f) => f.debt_free_date)?.debt_free_date;
  const monthsToPayoff = chartData.length;

  // Forecast summary (last month with total ending debt > 0 or the total)
  const lastForecastDebt = chartData.length > 0 ? chartData[chartData.length - 1].totalDebt : null;

  // Cliff months for reference lines
  const cliffMonthLabels = chartData.filter((d) => d.hasCliff).map((d) => d.month);

  if (accLoading || cardsLoading) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <SummaryCard title="Total Balance" value={`£${totalBalance.toFixed(2)}`}
          color="bg-green-50 text-green-700 border-green-200" />
        <SummaryCard title="Total Debt" value={`£${totalDebt.toFixed(2)}`}
          color="bg-red-50 text-red-700 border-red-200" />
        <SummaryCard title="Available for Debt"
          value={availLoading ? '...' : available ? `£${available.available_for_debt.toFixed(2)}` : '—'}
          color="bg-amber-50 text-amber-700 border-amber-200" />
        <SummaryCard title="Debt Free"
          value={debtFreeDate ? debtFreeDate.slice(0, 7) : '—'}
          subtitle={debtFreeDate ? `${monthsToPayoff} months` : null}
          color="bg-indigo-50 text-indigo-700 border-indigo-200" />
        <SummaryCard title="Forecast Balance (12m)"
          value={lastForecastDebt != null ? `£${lastForecastDebt.toFixed(2)}` : '—'}
          color={lastForecastDebt === 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-700 border-gray-200'} />
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-3">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={async () => {
              setForecastRunning(true);
              setForecastMsg(null);
              try {
                const budget = available?.available_for_debt || null;
                const res = await calculateForecast({ strategy: 'avalanche', monthly_budget: budget, months: 60 });
                const d = res.data;
                setForecastMsg(
                  `Forecast complete — ${d.summary?.monthsToPayoff || 0} months to payoff` +
                  (d.debt_free_date ? ` (${d.debt_free_date.slice(0, 7)})` : '') +
                  `, £${d.summary?.totalInterest?.toFixed(2) || '0.00'} total interest` +
                  (d.cliffs?.length > 0 ? `, ${d.cliffs.length} cliff warning(s)` : '')
                );
                // Reload forecast data
                const [fRes, pRes] = await Promise.all([getForecasts(), getPayoffSchedule()]);
                setForecasts(fRes.data);
                setPayoff(pRes.data);
              } catch (err) {
                setForecastMsg('Failed: ' + (err.response?.data?.error || err.message));
              }
              setForecastRunning(false);
            }}
            disabled={forecastRunning}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:bg-indigo-300"
          >
            {forecastRunning ? 'Running...' : 'Run Forecast (Avalanche)'}
          </button>
          <button
            onClick={() => navigate('/forecast')}
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-50"
          >
            View Forecast
          </button>
          <button
            onClick={() => navigate('/budgets')}
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-50"
          >
            Manage Budgets
          </button>
        </div>
        {forecastMsg && (
          <p className={`mt-3 text-sm ${forecastMsg.startsWith('Failed') ? 'text-red-600' : 'text-green-600'}`}>
            {forecastMsg}
          </p>
        )}
      </div>

      {/* 12-Month Balance Projection Chart */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">12-Month Debt Projection</h2>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `£${v.toLocaleString()}`} />
              <Tooltip formatter={(v) => `£${parseFloat(v).toFixed(2)}`} />
              <Legend />
              <Line type="monotone" dataKey="totalDebt" name="Total Debt"
                stroke="#1f2937" strokeWidth={2} dot={false} />
              {cardNames.map((name, i) => (
                <Line key={name} type="monotone" dataKey={name}
                  stroke={colors[i % colors.length]} strokeWidth={1.5} dot={false} />
              ))}
              {cliffMonthLabels.map((m) => (
                <ReferenceLine key={m} x={m} stroke="#f59e0b" strokeDasharray="5 5"
                  label={{ value: 'CLIFF', position: 'top', fill: '#f59e0b', fontSize: 9 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Cliff Warnings */}
      {cliffs.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-amber-800 mb-2">
            Promo Rate Cliff Warnings ({cliffs.length})
          </h3>
          <div className="space-y-1">
            {cliffs.map((c, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="font-medium text-amber-900">{c.card_name} — {c.bucket_name}</span>
                <span className="text-amber-700">
                  {(c.from_apr * 100).toFixed(1)}% → {(c.to_apr * 100).toFixed(1)}% on {c.promo_end_date?.slice(0, 7)}
                  <span className="text-red-600 ml-2 font-medium">+£{c.monthly_interest_increase?.toFixed(0)}/mo</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Avalanche Strategy + Payoff Dates (side by side) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Avalanche Strategy */}
        {strategy.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-3">Avalanche Priority</h2>
            <p className="text-xs text-gray-500 mb-3">Payment order: highest APR first</p>
            <div className="space-y-2">
              {strategy.map((c, i) => (
                <div key={c.card_id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ backgroundColor: colors[i % colors.length] }}>
                      {i + 1}
                    </span>
                    <span className="font-medium text-sm">{c.card_name}</span>
                    <span className="text-xs text-gray-400">{(c.max_effective_apr * 100).toFixed(1)}%</span>
                  </div>
                  <span className="font-mono text-sm text-red-600">£{c.total_balance.toFixed(0)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Payoff Schedule */}
        {payoff.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-3">Payoff Dates</h2>
            <div className="space-y-2">
              {payoff.map((p) => {
                const monthsAway = p.payoff_month
                  ? Math.ceil((new Date(p.payoff_month) - new Date()) / (30 * 24 * 60 * 60 * 1000))
                  : null;
                return (
                  <div key={p.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <span className="font-medium text-sm">{p.card?.name || 'Card'}</span>
                    <div className="text-right text-sm">
                      <span className="text-green-600 font-medium">{p.payoff_month?.slice(0, 7)}</span>
                      {monthsAway != null && (
                        <span className="text-gray-400 ml-1">({monthsAway}m)</span>
                      )}
                      <span className="text-gray-500 ml-2">
                        Interest: £{parseFloat(p.total_interest_on_card || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Available Funds Breakdown */}
      {available && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">This Month's Cash Flow</h2>
          <div className="space-y-3">
            <FlowRow label="Account Balances" value={available.total_balance} positive />
            <FlowRow label="Recurring Bills" value={-available.recurring_bills} />
            {Object.entries(available.bill_breakdown || {}).map(([cat, amt]) => (
              <FlowRow key={cat} label={`  └ ${cat}`} value={-amt} sub />
            ))}
            <FlowRow label="Budgeted Spending" value={-available.budgeted_spending} />
            {(available.budgets || []).map((b, i) => (
              <FlowRow key={i} label={`  └ ${b.category}`} value={-b.allocated} sub />
            ))}
            <FlowRow label="Credit Card Min Payments" value={-available.credit_card_min_payments} />
            {(available.card_min_payments || []).map((c, i) => (
              <FlowRow key={i} label={`  └ ${c.card_name} (bal: £${c.balance.toFixed(0)})`} value={-c.min_payment} sub />
            ))}
            <div className="border-t pt-2 mt-2">
              <FlowRow label="Total Outflow" value={-available.total_outflow} bold />
            </div>
            <div className="border-t-2 border-indigo-200 pt-2 mt-2">
              <div className="flex justify-between items-center">
                <span className="font-bold text-lg">Available for Debt Repayment</span>
                <span className={`font-bold text-lg font-mono ${available.available_for_debt > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  £{available.available_for_debt.toFixed(2)}
                </span>
              </div>
              {available.raw_available < 0 && (
                <p className="text-red-600 text-sm mt-1">Your outflows exceed your balance by £{Math.abs(available.raw_available).toFixed(2)}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Accounts */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Account Summary</h2>
        {accounts.length === 0 ? (
          <p className="text-gray-500">No accounts yet. Add one in the Accounts page.</p>
        ) : (
          <div className="space-y-2">
            {accounts.map((a) => (
              <div key={a.id} className="flex justify-between items-center py-2 border-b last:border-0">
                <div>
                  <span className="font-medium">{a.name}</span>
                  <span className="ml-2 text-xs text-gray-500 capitalize">{a.type}</span>
                </div>
                <span className="font-mono font-semibold">£{parseFloat(a.balance).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Credit Cards */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Credit Cards</h2>
        {cards.length === 0 ? (
          <p className="text-gray-500">No credit cards yet. Add one in the Credit Cards page.</p>
        ) : (
          <div className="space-y-3">
            {cards.map((c) => {
              const debt = (c.buckets || []).reduce((s, b) => s + parseFloat(b.current_balance || 0), 0);
              return (
                <div key={c.id} className="flex justify-between items-center py-2 border-b last:border-0">
                  <div>
                    <span className="font-medium">{c.name}</span>
                    <span className="ml-2 text-xs text-gray-500">APR: {(parseFloat(c.standard_apr || 0) * 100).toFixed(1)}%</span>
                    <span className="ml-2 text-xs text-gray-400">{(c.buckets || []).length} bucket(s)</span>
                  </div>
                  <span className={`font-mono font-semibold ${debt > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    £{debt.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ title, value, color, subtitle }) {
  return (
    <div className={`rounded-lg border p-4 ${color}`}>
      <div className="text-sm font-medium">{title}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {subtitle && <div className="text-xs mt-1 opacity-75">{subtitle}</div>}
    </div>
  );
}

function FlowRow({ label, value, positive, sub, bold }) {
  const color = value > 0 ? 'text-green-600' : value < 0 ? 'text-red-600' : 'text-gray-600';
  return (
    <div className={`flex justify-between items-center ${sub ? 'text-sm text-gray-500' : ''} ${bold ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span className={`font-mono ${color}`}>
        {value >= 0 ? '' : '-'}£{Math.abs(value).toFixed(2)}
      </span>
    </div>
  );
}
