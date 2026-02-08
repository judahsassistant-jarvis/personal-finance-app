/**
 * E2E Smoke Test
 *
 * Verifies all core API endpoints work correctly:
 * 1. Health check
 * 2. Accounts CRUD
 * 3. Credit Cards + Buckets CRUD
 * 4. Transactions
 * 5. Budgets + Suggestions
 * 6. Debt Config
 * 7. Forecast calculation
 * 8. Available funds
 *
 * Usage: node server/src/tests/e2e-smoke.js
 * Requires the server to be running on port 3001.
 */

const BASE = 'http://localhost:3001/api';

let passed = 0;
let failed = 0;

async function request(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}`);
    failed++;
  }
}

async function run() {
  console.log('=== E2E Smoke Test ===\n');

  // 1. Health
  console.log('[Health Check]');
  const health = await request('GET', '/health');
  assert(health.status === 200, 'GET /health returns 200');
  assert(health.data.status === 'ok', 'Health status is "ok"');

  // 2. Accounts
  console.log('\n[Accounts]');
  const accCreate = await request('POST', '/accounts', { name: 'Test Checking', type: 'checking', balance: 5000 });
  assert(accCreate.status === 201, 'POST /accounts creates account');
  const accId = accCreate.data.id;
  assert(accId, 'Account has UUID id');

  const accList = await request('GET', '/accounts');
  assert(accList.status === 200, 'GET /accounts returns 200');
  assert(Array.isArray(accList.data), 'Returns array of accounts');

  const accUpdate = await request('PUT', `/accounts/${accId}`, { balance: 5500 });
  assert(accUpdate.status === 200, 'PUT /accounts/:id updates account');
  assert(parseFloat(accUpdate.data.balance) === 5500, 'Balance updated to 5500');

  // Validation test
  const accBadCreate = await request('POST', '/accounts', { name: '' });
  assert(accBadCreate.status === 400, 'POST /accounts with empty name returns 400');

  // 3. Credit Cards + Buckets
  console.log('\n[Credit Cards]');
  const cardCreate = await request('POST', '/credit-cards', {
    name: 'Test Visa',
    standard_apr: 0.199,
    min_percentage: 0.02,
    min_floor: 25,
    credit_limit: 5000,
    statement_date: 15,
  });
  assert(cardCreate.status === 201, 'POST /credit-cards creates card');
  const cardId = cardCreate.data.id;

  const bucketCreate = await request('POST', '/card-buckets', {
    card_id: cardId,
    bucket_name: 'Main Balance',
    bucket_type: 'purchases',
    current_balance: 2500,
  });
  assert(bucketCreate.status === 201, 'POST /card-buckets creates bucket');
  const bucketId = bucketCreate.data.id;

  const bucket2 = await request('POST', '/card-buckets', {
    card_id: cardId,
    bucket_name: 'BT Promo',
    bucket_type: 'transfer',
    current_balance: 1500,
    promo_apr: 0,
    promo_end_date: '2026-12-01',
  });
  assert(bucket2.status === 201, 'POST /card-buckets creates promo bucket');

  const cardGet = await request('GET', `/credit-cards/${cardId}`);
  assert(cardGet.data.buckets?.length === 2, 'Card has 2 buckets');

  // 4. Transactions
  console.log('\n[Transactions]');
  const txnCreate = await request('POST', '/transactions', {
    account_id: accId,
    date: '2026-01-15',
    amount: -50.00,
    merchant: 'Tesco',
    category: 'Shopping',
    description: 'Groceries',
  });
  assert(txnCreate.status === 201, 'POST /transactions creates transaction');

  const txnList = await request('GET', `/transactions?account_id=${accId}`);
  assert(txnList.status === 200, 'GET /transactions with filter returns 200');

  // 5. Budgets
  console.log('\n[Budgets]');
  const month = '2026-02-01';
  const budgetCreate = await request('POST', '/budgets', {
    month,
    budget_category: 'Food',
    allocated_amount: 300,
  });
  assert(budgetCreate.status === 201, 'POST /budgets creates budget');

  const budgetList = await request('GET', `/budgets?month=${month}`);
  assert(budgetList.status === 200, 'GET /budgets returns 200');
  assert(budgetList.data.length >= 1, 'Has at least 1 budget');

  // Budget Suggestions
  const suggestions = await request('GET', `/budgets/suggestions?month=${month}`);
  assert(suggestions.status === 200, 'GET /budgets/suggestions returns 200');
  assert(suggestions.data.analysis !== undefined, 'Suggestions include analysis');

  // 6. Debt Config
  console.log('\n[Debt Config]');
  const dcCreate = await request('POST', '/debt-config', {
    month,
    strategy: 'avalanche',
    auto_calculate: true,
  });
  assert(dcCreate.status === 201, 'POST /debt-config creates config');

  const dcList = await request('GET', `/debt-config?month=${month}`);
  assert(dcList.status === 200, 'GET /debt-config returns 200');

  // 7. Forecast
  console.log('\n[Forecast]');
  const forecast = await request('POST', '/forecasts/calculate', {
    strategy: 'avalanche',
    monthly_budget: 500,
  });
  assert(forecast.status === 200, 'POST /forecasts/calculate returns 200');
  assert(forecast.data.summary !== undefined, 'Forecast includes summary');
  assert(forecast.data.forecast_count > 0, 'Forecast generated results');
  console.log(`  INFO: ${forecast.data.summary.monthsToPayoff} months to payoff, ` +
    `£${forecast.data.summary.totalInterest.toFixed(2)} total interest`);

  const forecastList = await request('GET', '/forecasts');
  assert(forecastList.status === 200, 'GET /forecasts returns 200');
  assert(forecastList.data.length > 0, 'Forecast results exist');

  const payoff = await request('GET', '/forecasts/payoff');
  assert(payoff.status === 200, 'GET /forecasts/payoff returns 200');

  // Re-run with snowball for comparison
  const snowball = await request('POST', '/forecasts/calculate', {
    strategy: 'snowball',
    monthly_budget: 500,
  });
  assert(snowball.status === 200, 'Snowball forecast returns 200');
  console.log(`  INFO: Snowball: ${snowball.data.summary.monthsToPayoff} months, ` +
    `£${snowball.data.summary.totalInterest.toFixed(2)} interest`);

  // 8. Available Funds
  console.log('\n[Available Funds]');
  const avail = await request('GET', `/available?month=${month}`);
  assert(avail.status === 200, 'GET /available returns 200');
  assert(avail.data.total_balance !== undefined, 'Has total_balance');
  assert(avail.data.available_for_debt !== undefined, 'Has available_for_debt');
  assert(avail.data.card_min_payments !== undefined, 'Has card_min_payments');

  // 9. Cleanup
  console.log('\n[Cleanup]');
  const delForecast = await request('DELETE', '/forecasts');
  assert(delForecast.status === 204, 'DELETE /forecasts clears results');

  const delBudget = await request('DELETE', `/budgets/${budgetCreate.data.id}`);
  assert(delBudget.status === 204, 'DELETE /budgets/:id removes budget');

  const delBucket = await request('DELETE', `/card-buckets/${bucketId}`);
  assert(delBucket.status === 204, 'DELETE /card-buckets/:id removes bucket');

  const delCard = await request('DELETE', `/credit-cards/${cardId}`);
  assert(delCard.status === 204, 'DELETE /credit-cards/:id removes card');

  const delAcc = await request('DELETE', `/accounts/${accId}`);
  assert(delAcc.status === 204, 'DELETE /accounts/:id removes account');

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test error:', err.message);
  process.exit(1);
});
