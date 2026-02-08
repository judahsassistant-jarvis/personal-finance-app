import { useEffect, useState } from 'react';
import { getForecasts, getPayoffSchedule } from '../api/client';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function Forecast() {
  const [forecasts, setForecasts] = useState([]);
  const [payoff, setPayoff] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [fRes, pRes] = await Promise.all([getForecasts(), getPayoffSchedule()]);
        setForecasts(fRes.data);
        setPayoff(pRes.data);
      } catch (err) {
        console.error(err);
      }
      setLoading(false);
    };
    load();
  }, []);

  // Build chart data from forecasts
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
  }
  Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month)).forEach((m) => chartData.push(m));

  const cardNames = [...new Set(forecasts.filter((f) => f.card?.name).map((f) => f.card.name))];
  const colors = ['#6366f1', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316'];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Debt Forecast</h1>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : forecasts.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500 text-lg mb-2">No forecast data yet</p>
          <p className="text-gray-400 text-sm">
            Set up your credit cards with buckets, configure debt settings, and run the forecast engine to see projections here.
          </p>
        </div>
      ) : (
        <>
          {/* Chart */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Debt Over Time</h2>
            <ResponsiveContainer width="100%" height={400}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `\u00a3${v.toLocaleString()}`} />
                <Tooltip formatter={(v) => `\u00a3${parseFloat(v).toFixed(2)}`} />
                <Legend />
                {cardNames.map((name, i) => (
                  <Area key={name} type="monotone" dataKey={name}
                    stackId="1" fill={colors[i % colors.length]}
                    stroke={colors[i % colors.length]} fillOpacity={0.6} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Payoff Schedule */}
          {payoff.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold mb-4">Payoff Schedule</h2>
              <div className="space-y-2">
                {payoff.map((p) => (
                  <div key={p.id} className="flex justify-between items-center py-2 border-b">
                    <span className="font-medium">{p.card?.name || 'Card'}</span>
                    <span className="text-gray-600">Paid off: {p.payoff_month}</span>
                    <span className="text-gray-500">Interest: {'\u00a3'}{parseFloat(p.total_interest_on_card || 0).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Forecast Table */}
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
                </tr>
              </thead>
              <tbody className="divide-y">
                {[...new Set(forecasts.map((f) => f.month))].sort().map((month) => {
                  const monthData = forecasts.find((f) => f.month === month && f.total_beginning_debt);
                  if (!monthData) return null;
                  return (
                    <tr key={month} className="hover:bg-gray-50">
                      <td className="px-4 py-2">{month}</td>
                      <td className="px-4 py-2 text-right font-mono">{'\u00a3'}{parseFloat(monthData.total_beginning_debt || 0).toFixed(2)}</td>
                      <td className="px-4 py-2 text-right font-mono text-red-500">{'\u00a3'}{parseFloat(monthData.total_interest || 0).toFixed(2)}</td>
                      <td className="px-4 py-2 text-right font-mono">{'\u00a3'}{parseFloat(monthData.total_minimum_payments || 0).toFixed(2)}</td>
                      <td className="px-4 py-2 text-right font-mono text-green-600">{'\u00a3'}{parseFloat(monthData.total_extra_payments || 0).toFixed(2)}</td>
                      <td className="px-4 py-2 text-right font-mono font-semibold">{'\u00a3'}{parseFloat(monthData.total_ending_debt || 0).toFixed(2)}</td>
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
