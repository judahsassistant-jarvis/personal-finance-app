import { useEffect, useState, useCallback, useRef } from 'react';
import {
  getForecasts, getPayoffSchedule, calculateForecast, recalculateForecast,
  getDebtConfig, createDebtConfig, updateDebtConfig, getAvailableFunds,
  getAvalancheStrategy, getPromoCliffs,
} from '../api/client';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, BarChart, Bar, ReferenceLine,
} from 'recharts';

export default function Forecast() {
  const [forecasts, setForecasts] = useState([]);
  const [payoff, setPayoff] = useState([]);
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [calcResult, setCalcResult] = useState(null);
  const [error, setError] = useState(null);

  // Debt config state
  const [strategy, setStrategy] = useState('avalanche');
  const [monthlyBudget, setMonthlyBudget] = useState('');
  const [autoCalculate, setAutoCalculate] = useState(true);
  const [configId, setConfigId] = useState(null);
  const [availableForDebt, setAvailableForDebt] = useState(null);

  // Avalanche strategy and cliffs
  const [avalancheCards, setAvalancheCards] = useState([]);
  const [cliffs, setCliffs] = useState([]);
  const [cashFlow, setCashFlow] = useState(null);

  // Live re-forecast debounce
  const recalcTimer = useRef(null);

  const currentMonth = new Date().toISOString().slice(0, 7) + '-01';

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [fRes, pRes, dcRes, avRes, stratRes, cliffRes] = await Promise.all([
        getForecasts(),
        getPayoffSchedule(),
        getDebtConfig(currentMonth),
        getAvailableFunds(currentMonth),
        getAvalancheStrategy(),
        getPromoCliffs(12),
      ]);
      setForecasts(fRes.data);
      setPayoff(pRes.data);
      setAvailableForDebt(avRes.data.available_for_debt);
      setAvalancheCards(stratRes.data.cards || []);
      setCliffs(cliffRes.data.cliffs || []);

      if (dcRes.data.length > 0) {
        const cfg = dcRes.data[0];
        setStrategy(cfg.strategy);
        setAutoCalculate(cfg.auto_calculate);
        if (cfg.monthly_payment_budget != null) {
          setMonthlyBudget(String(cfg.monthly_payment_budget));
        }
        setConfigId(cfg.id);
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, [currentMonth]);

  useEffect(() => { loadData(); }, [loadData]);

  const saveConfig = async () => {
    const data = {
      month: currentMonth,
      strategy,
      auto_calculate: autoCalculate,
      monthly_payment_budget: autoCalculate ? null : (parseFloat(monthlyBudget) || null),
    };
    try {
      if (configId) {
        await updateDebtConfig(configId, data);
      } else {
        const res = await createDebtConfig(data);
        setConfigId(res.data.id);
      }
    } catch (err) {
      console.error('Failed to save config:', err);
    }
  };

  const runForecast = async () => {
    setCalculating(true);
    setError(null);
    setCalcResult(null);
    try {
      await saveConfig();
      const budget = autoCalculate ? availableForDebt : (parseFloat(monthlyBudget) || null);
      const res = await calculateForecast({
        strategy,
        monthly_budget: budget,
      });
      setCalcResult(res.data);
      setCashFlow(res.data.cash_flow || null);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to run forecast');
    }
    setCalculating(false);
  };

  // Live re-forecast: auto-recalculate when strategy or budget changes
  const triggerLiveRecalc = useCallback(() => {
    if (recalcTimer.current) clearTimeout(recalcTimer.current);
    recalcTimer.current = setTimeout(async () => {
      setCalculating(true);
      try {
        const budget = autoCalculate ? null : (parseFloat(monthlyBudget) || null);
        const res = await recalculateForecast({
          strategy,
          monthly_budget: budget,
          months: 12,
        });
        setForecasts(res.data.forecasts || []);
        setPayoff(res.data.payoff_schedule || []);
        setCalcResult(res.data);
        setCashFlow(res.data.cash_flow || null);
        if (res.data.cliffs) setCliffs(res.data.cliffs);
      } catch (err) {
        console.error('Live recalc failed:', err);
      }
      setCalculating(false);
    }, 600);
  }, [strategy, monthlyBudget, autoCalculate]);

  // When strategy or budget changes, trigger live recalc if we already have forecast data
  useEffect(() => {
    if (forecasts.length > 0) {
      triggerLiveRecalc();
    }
    return () => { if (recalcTimer.current) clearTimeout(recalcTimer.current); };
  }, [strategy, autoCalculate]);

  // Build chart data
  const chartData = [];
  const monthMap = {};
  for (const f of forecasts) {
    if (!monthMap[f.month]) {
      monthMap[f.month] = { month: f.month, total: 0 };
    }
    if (f.card_ending_balance) {
      monthMap[f.month][f.card?.name || f.card_id] = parseFloat(f.card_ending_balance);
    }
    if (f.total_ending_debt) {
      monthMap[f.month].total = parseFloat(f.total_ending_debt);
    }
    if (f.has_cliff) {
      monthMap[f.month].hasCliff = true;
    }
  }
  Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month)).forEach((m) => chartData.push(m));

  // Payment breakdown for bar chart
  const paymentData = [];
  for (const f of forecasts) {
    if (f.card_id === null && f.total_beginning_debt) {
      paymentData.push({
        month: f.month.slice(0, 7),
        interest: parseFloat(f.total_interest || 0),
        minPayments: parseFloat(f.total_minimum_payments || 0),
        extraPayments: parseFloat(f.total_extra_payments || 0),
      });
    }
  }

  const cardNames = [...new Set(forecasts.filter((f) => f.card?.name).map((f) => f.card.name))];
  const colors = ['#6366f1', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

  const debtFreeDate = calcResult?.debt_free_date ||
    forecasts.find((f) => f.debt_free_date)?.debt_free_date;

  // Find cliff months for chart reference lines
  const cliffMonths = chartData.filter((d) => d.hasCliff).map((d) => d.month);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Debt Forecast</h1>

      {/* Forecast Settings */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Forecast Settings</h2>
          {calculating && (
            <span className="text-sm text-indigo-600 animate-pulse">Recalculating...</span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Strategy</label>
            <div className="flex rounded-md shadow-sm">
              <button
                onClick={() => setStrategy('avalanche')}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-l-md border ${
                  strategy === 'avalanche'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                Avalanche
              </button>
              <button
                onClick={() => setStrategy('snowball')}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-r-md border-t border-b border-r ${
                  strategy === 'snowball'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                Snowball
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {strategy === 'avalanche'
                ? 'Pays highest APR first (saves most interest)'
                : 'Pays lowest balance first (fastest wins)'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Payment Budget</label>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-xs text-gray-500 flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={autoCalculate}
                  onChange={(e) => setAutoCalculate(e.target.checked)}
                  className="rounded"
                />
                Auto from available funds
              </label>
            </div>
            {autoCalculate ? (
              <div className="px-3 py-2 bg-gray-50 border rounded-md text-sm text-gray-600">
                {availableForDebt != null ? `£${availableForDebt.toFixed(2)}` : 'Loading...'}
              </div>
            ) : (
              <div className="relative">
                <span className="absolute left-3 top-2 text-gray-500">£</span>
                <input
                  type="number"
                  value={monthlyBudget}
                  onChange={(e) => {
                    setMonthlyBudget(e.target.value);
                    if (forecasts.length > 0) triggerLiveRecalc();
                  }}
                  className="w-full pl-7 pr-3 py-2 border rounded-md"
                  placeholder="0.00"
                  min="0"
                  step="10"
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Info</label>
            <div className="text-sm space-y-1 text-gray-600">
              <div>Cards: <span className="font-medium">{cardNames.length || '—'}</span></div>
              <div>Months projected: <span className="font-medium">{chartData.length || '—'}</span></div>
              {debtFreeDate && (
                <div className="text-green-600 font-medium">Debt free: {debtFreeDate.slice(0, 7)}</div>
              )}
            </div>
          </div>

          <div className="flex items-end">
            <button
              onClick={runForecast}
              disabled={calculating}
              className="w-full px-4 py-3 bg-indigo-600 text-white rounded-md font-medium hover:bg-indigo-700 disabled:bg-indigo-300 transition-colors"
            >
              {calculating ? 'Calculating...' : 'Run Forecast'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 p-3 bg-red-50 text-red-700 rounded-md text-sm">{error}</div>
        )}
        {calcResult && !error && (
          <div className="mt-3 p-3 bg-green-50 text-green-700 rounded-md text-sm">
            {calcResult.message}
            {calcResult.summary && (
              <span className="ml-2">
                — Total interest: £{calcResult.summary.totalInterest?.toFixed(2)},
                {' '}Payoff in {calcResult.summary.monthsToPayoff} months
                {calcResult.debt_free_date && ` (${calcResult.debt_free_date.slice(0, 7)})`}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Cliff Warnings */}
      {cliffs.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-amber-800 mb-2">
            Promo Rate Expirations ({cliffs.length})
          </h3>
          <div className="space-y-2">
            {cliffs.map((c, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium text-amber-900">{c.card_name}</span>
                  <span className="text-amber-700 ml-1">— {c.bucket_name}</span>
                </div>
                <div className="text-right">
                  <span className="text-amber-700">
                    {(c.from_apr * 100).toFixed(1)}% → {(c.to_apr * 100).toFixed(1)}%
                  </span>
                  <span className="text-amber-600 ml-2">
                    {c.promo_end_date?.slice(0, 7)} ({c.months_until_cliff}m)
                  </span>
                  <span className="text-red-600 ml-2 font-medium">
                    +£{c.monthly_interest_increase?.toFixed(0)}/mo
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Avalanche Strategy Order */}
      {avalancheCards.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-3">Avalanche Priority Order</h2>
          <p className="text-xs text-gray-500 mb-3">Cards sorted by highest effective APR — extra payments go here first</p>
          <div className="space-y-2">
            {avalancheCards.map((c, i) => (
              <div key={c.card_id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{ backgroundColor: colors[i % colors.length] }}>
                    {i + 1}
                  </span>
                  <div>
                    <span className="font-medium">{c.card_name}</span>
                    <span className="ml-2 text-xs text-gray-500">
                      APR: {(c.max_effective_apr * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="text-right text-sm">
                  <span className="font-mono font-semibold text-red-600">£{c.total_balance.toFixed(2)}</span>
                  <span className="text-gray-400 ml-2">min: £{c.min_payment.toFixed(0)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : forecasts.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500 text-lg mb-2">No forecast data yet</p>
          <p className="text-gray-400 text-sm">
            Set up your credit cards with buckets, then click "Run Forecast" above to see projections.
          </p>
        </div>
      ) : (
        <>
          {/* Debt Over Time */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Debt Over Time</h2>
            <ResponsiveContainer width="100%" height={400}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} tickFormatter={(v) => v.slice(0, 7)} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `£${v.toLocaleString()}`} />
                <Tooltip formatter={(v) => `£${parseFloat(v).toFixed(2)}`} labelFormatter={(l) => l.slice(0, 7)} />
                <Legend />
                {cardNames.map((name, i) => (
                  <Area key={name} type="monotone" dataKey={name}
                    stackId="1" fill={colors[i % colors.length]}
                    stroke={colors[i % colors.length]} fillOpacity={0.6} />
                ))}
                {cliffMonths.map((m) => (
                  <ReferenceLine key={m} x={m} stroke="#f59e0b" strokeDasharray="5 5"
                    label={{ value: 'CLIFF', position: 'top', fill: '#f59e0b', fontSize: 10 }} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Payment Breakdown */}
          {paymentData.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold mb-4">Payment Breakdown</h2>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={paymentData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `£${v}`} />
                  <Tooltip formatter={(v) => `£${parseFloat(v).toFixed(2)}`} />
                  <Legend />
                  <Bar dataKey="interest" name="Interest" fill="#ef4444" stackId="payments" />
                  <Bar dataKey="minPayments" name="Min Payments" fill="#6366f1" stackId="payments" />
                  <Bar dataKey="extraPayments" name="Extra Payments" fill="#10b981" stackId="payments" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Payoff Schedule */}
          {payoff.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold mb-4">Payoff Schedule</h2>
              <div className="space-y-2">
                {payoff.map((p) => (
                  <div key={p.id} className="flex justify-between items-center py-2 border-b">
                    <span className="font-medium">{p.card?.name || 'Card'}</span>
                    <span className="text-gray-600">Paid off: {p.payoff_month?.slice(0, 7) || '—'}</span>
                    <span className="text-gray-500">Interest: £{parseFloat(p.total_interest_on_card || 0).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Monthly Breakdown Table */}
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <h2 className="text-lg font-semibold p-6 pb-2">Monthly Breakdown</h2>
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Month</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Start Debt</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Interest</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Min Payments</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Extra</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">End Debt</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">Alerts</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[...new Set(forecasts.map((f) => f.month))].sort().map((month) => {
                  const monthData = forecasts.find((f) => f.month === month && f.total_beginning_debt);
                  if (!monthData) return null;
                  const isCliff = monthData.has_cliff;
                  return (
                    <tr key={month} className={`hover:bg-gray-50 ${isCliff ? 'bg-amber-50' : ''}`}>
                      <td className="px-4 py-2">{month.slice(0, 7)}</td>
                      <td className="px-4 py-2 text-right font-mono">£{parseFloat(monthData.total_beginning_debt || 0).toFixed(2)}</td>
                      <td className="px-4 py-2 text-right font-mono text-red-500">£{parseFloat(monthData.total_interest || 0).toFixed(2)}</td>
                      <td className="px-4 py-2 text-right font-mono">£{parseFloat(monthData.total_minimum_payments || 0).toFixed(2)}</td>
                      <td className="px-4 py-2 text-right font-mono text-green-600">£{parseFloat(monthData.total_extra_payments || 0).toFixed(2)}</td>
                      <td className="px-4 py-2 text-right font-mono font-semibold">£{parseFloat(monthData.total_ending_debt || 0).toFixed(2)}</td>
                      <td className="px-4 py-2 text-center">
                        {isCliff && <span className="text-amber-600 text-xs font-medium">CLIFF</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
