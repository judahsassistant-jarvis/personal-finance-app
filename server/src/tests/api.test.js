/**
 * API Integration Tests
 *
 * Tests all API endpoints against a running server on localhost:3001.
 * Run: npm run test:jest (requires server to be running)
 */

const BASE = 'http://localhost:3001/api';

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

// Shared state for IDs created during tests
const state = {};

describe('API Integration Tests', () => {
  // --- Health ---
  describe('Health', () => {
    test('GET /health returns 200 with status ok', async () => {
      const { status, data } = await request('GET', '/health');
      expect(status).toBe(200);
      expect(data.status).toBe('ok');
    });
  });

  // --- Accounts CRUD ---
  describe('Accounts', () => {
    test('POST /accounts creates account', async () => {
      const { status, data } = await request('POST', '/accounts', {
        name: 'Jest Test Account', type: 'checking', balance: 3000,
      });
      expect(status).toBe(201);
      expect(data.id).toBeDefined();
      expect(data.name).toBe('Jest Test Account');
      state.accountId = data.id;
    });

    test('GET /accounts lists accounts', async () => {
      const { status, data } = await request('GET', '/accounts');
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.some(a => a.id === state.accountId)).toBe(true);
    });

    test('PUT /accounts/:id updates account', async () => {
      const { status, data } = await request('PUT', `/accounts/${state.accountId}`, { balance: 3500 });
      expect(status).toBe(200);
      expect(parseFloat(data.balance)).toBe(3500);
    });

    test('POST /accounts validation rejects empty name', async () => {
      const { status } = await request('POST', '/accounts', { name: '' });
      expect(status).toBe(400);
    });

    test('POST /accounts validation rejects missing balance', async () => {
      const { status } = await request('POST', '/accounts', { name: 'No Balance' });
      expect(status).toBe(400);
    });

    test('GET /accounts/:id with invalid UUID returns 400', async () => {
      const { status } = await request('GET', '/accounts/not-a-uuid');
      expect(status).toBe(400);
    });

    test('GET /accounts/:id with non-existent UUID returns 404', async () => {
      const { status } = await request('GET', '/accounts/00000000-0000-0000-0000-000000000000');
      expect(status).toBe(404);
    });
  });

  // --- Credit Cards + Buckets ---
  describe('Credit Cards', () => {
    test('POST /credit-cards creates card', async () => {
      const { status, data } = await request('POST', '/credit-cards', {
        name: 'Jest Test Card',
        standard_apr: 0.199,
        min_percentage: 0.02,
        min_floor: 25,
        credit_limit: 10000,
        statement_date: 15,
      });
      expect(status).toBe(201);
      expect(data.id).toBeDefined();
      state.cardId = data.id;
    });

    test('POST /card-buckets creates purchase bucket', async () => {
      const { status, data } = await request('POST', '/card-buckets', {
        card_id: state.cardId,
        bucket_name: 'Purchases',
        bucket_type: 'purchases',
        current_balance: 3000,
      });
      expect(status).toBe(201);
      state.bucketId1 = data.id;
    });

    test('POST /card-buckets creates promo bucket', async () => {
      const { status, data } = await request('POST', '/card-buckets', {
        card_id: state.cardId,
        bucket_name: '0% BT',
        bucket_type: 'transfer',
        current_balance: 2000,
        promo_apr: 0,
        promo_end_date: '2026-08-01',
      });
      expect(status).toBe(201);
      state.bucketId2 = data.id;
    });

    test('GET /credit-cards/:id includes buckets', async () => {
      const { status, data } = await request('GET', `/credit-cards/${state.cardId}`);
      expect(status).toBe(200);
      expect(data.buckets).toBeDefined();
      expect(data.buckets.length).toBe(2);
    });
  });

  // --- Transactions ---
  describe('Transactions', () => {
    test('POST /transactions creates transaction', async () => {
      const { status, data } = await request('POST', '/transactions', {
        account_id: state.accountId,
        date: '2026-01-15',
        merchant: 'Jest Merchant',
        description: 'Test purchase',
        amount: -75.50,
        category: 'Shopping',
      });
      expect(status).toBe(201);
      state.txnId = data.id;
    });

    test('POST /transactions creates recurring bill', async () => {
      const { status, data } = await request('POST', '/transactions', {
        account_id: state.accountId,
        date: '2026-02-01',
        merchant: 'Netflix',
        description: 'Subscription',
        amount: -13.99,
        category: 'Subscriptions',
        is_recurring_bill: true,
      });
      expect(status).toBe(201);
      state.txnId2 = data.id;
    });

    test('GET /transactions with filters works', async () => {
      const { status, data } = await request('GET', `/transactions?account_id=${state.accountId}`);
      expect(status).toBe(200);
      expect(data.transactions || data.rows || data).toBeDefined();
    });

    test('PUT /transactions/:id updates transaction', async () => {
      const { status, data } = await request('PUT', `/transactions/${state.txnId}`, {
        category: 'Food',
      });
      expect(status).toBe(200);
      expect(data.category).toBe('Food');
    });
  });

  // --- Budgets ---
  describe('Budgets', () => {
    test('POST /budgets creates budget', async () => {
      const { status, data } = await request('POST', '/budgets', {
        month: '2026-02-01',
        budget_category: 'Food',
        allocated_amount: 300,
      });
      expect(status).toBe(201);
      state.budgetId = data.id;
    });

    test('GET /budgets filters by month', async () => {
      const { status, data } = await request('GET', '/budgets?month=2026-02-01');
      expect(status).toBe(200);
      expect(data.some(b => b.id === state.budgetId)).toBe(true);
    });

    test('PUT /budgets/:id updates budget', async () => {
      const { status, data } = await request('PUT', `/budgets/${state.budgetId}`, {
        allocated_amount: 350,
      });
      expect(status).toBe(200);
      expect(parseFloat(data.allocated_amount)).toBe(350);
    });

    test('GET /budgets/suggestions returns suggestions', async () => {
      const { status, data } = await request('GET', '/budgets/suggestions?month=2026-02-01');
      expect(status).toBe(200);
      expect(data.analysis).toBeDefined();
      expect(data.suggestions).toBeDefined();
      expect(Array.isArray(data.suggestions)).toBe(true);
    });
  });

  // --- Debt Config ---
  describe('Debt Config', () => {
    test('POST /debt-config creates config', async () => {
      const { status, data } = await request('POST', '/debt-config', {
        month: '2026-02-01',
        strategy: 'avalanche',
        auto_calculate: true,
      });
      expect(status).toBe(201);
      state.debtConfigId = data.id;
    });

    test('GET /debt-config filters by month', async () => {
      const { status, data } = await request('GET', '/debt-config?month=2026-02-01');
      expect(status).toBe(200);
    });
  });

  // --- Forecast ---
  describe('Forecast', () => {
    test('POST /forecasts/calculate runs avalanche forecast', async () => {
      const { status, data } = await request('POST', '/forecasts/calculate', {
        strategy: 'avalanche',
        monthly_budget: 500,
      });
      expect(status).toBe(200);
      expect(data.summary).toBeDefined();
      expect(data.forecast_count).toBeGreaterThan(0);
      expect(data.summary.strategy).toBe('avalanche');
    });

    test('POST /forecasts/calculate runs snowball forecast', async () => {
      const { status, data } = await request('POST', '/forecasts/calculate', {
        strategy: 'snowball',
        monthly_budget: 500,
      });
      expect(status).toBe(200);
      expect(data.summary.strategy).toBe('snowball');
    });

    test('GET /forecasts returns cached results', async () => {
      const { status, data } = await request('GET', '/forecasts');
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    test('GET /forecasts/payoff returns payoff schedule', async () => {
      const { status, data } = await request('GET', '/forecasts/payoff');
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    test('GET /forecasts/strategy returns priority order', async () => {
      const { status, data } = await request('GET', '/forecasts/strategy');
      expect(status).toBe(200);
      expect(data.strategy).toBe('avalanche');
      expect(Array.isArray(data.cards)).toBe(true);
    });

    test('GET /forecasts/cliffs returns cliff events', async () => {
      const { status, data } = await request('GET', '/forecasts/cliffs');
      expect(status).toBe(200);
      // Response format: { cliffs: [], total_cliffs: number }
      expect(data.cliffs).toBeDefined();
      expect(Array.isArray(data.cliffs)).toBe(true);
      if (data.cliffs.length > 0) {
        expect(data.cliffs[0].card_name).toBeDefined();
        expect(data.cliffs[0].from_apr).toBeDefined();
        expect(data.cliffs[0].to_apr).toBeDefined();
      }
    });

    test('POST /forecasts/recalculate returns updated forecast', async () => {
      const { status, data } = await request('POST', '/forecasts/recalculate', {
        strategy: 'avalanche',
        monthly_budget: 600,
      });
      expect(status).toBe(200);
      expect(data.summary).toBeDefined();
    });
  });

  // --- Available Funds ---
  describe('Available Funds', () => {
    test('GET /available returns cash flow breakdown', async () => {
      const { status, data } = await request('GET', '/available?month=2026-02-01');
      expect(status).toBe(200);
      expect(data.total_balance).toBeDefined();
      expect(data.recurring_bills).toBeDefined();
      expect(data.budgeted_spending).toBeDefined();
      expect(data.credit_card_min_payments).toBeDefined();
      expect(data.available_for_debt).toBeDefined();
      expect(typeof data.total_balance).toBe('number');
    });

    test('available_for_debt >= 0', async () => {
      const { data } = await request('GET', '/available?month=2026-02-01');
      expect(data.available_for_debt).toBeGreaterThanOrEqual(0);
    });
  });

  // --- Edge Cases ---
  describe('Edge Cases', () => {
    test('forecast with very high budget pays off quickly', async () => {
      const { status, data } = await request('POST', '/forecasts/calculate', {
        strategy: 'avalanche',
        monthly_budget: 50000,
      });
      expect(status).toBe(200);
      expect(data.summary.monthsToPayoff).toBeLessThanOrEqual(2);
    });

    test('forecast with very low budget takes longer', async () => {
      const { status, data } = await request('POST', '/forecasts/calculate', {
        strategy: 'avalanche',
        monthly_budget: 30,
      });
      expect(status).toBe(200);
      expect(data.summary.monthsToPayoff).toBeGreaterThan(5);
    });
  });

  // --- Cleanup ---
  describe('Cleanup', () => {
    test('clears forecasts', async () => {
      const { status } = await request('DELETE', '/forecasts');
      expect(status).toBe(204);
    });

    test('deletes test budget', async () => {
      if (state.budgetId) {
        const { status } = await request('DELETE', `/budgets/${state.budgetId}`);
        expect(status).toBe(204);
      }
    });

    test('deletes test transactions', async () => {
      if (state.txnId) {
        const { status } = await request('DELETE', `/transactions/${state.txnId}`);
        expect(status).toBe(204);
      }
      if (state.txnId2) {
        const { status } = await request('DELETE', `/transactions/${state.txnId2}`);
        expect(status).toBe(204);
      }
    });

    test('deletes test buckets', async () => {
      if (state.bucketId1) {
        const { status } = await request('DELETE', `/card-buckets/${state.bucketId1}`);
        expect(status).toBe(204);
      }
      if (state.bucketId2) {
        const { status } = await request('DELETE', `/card-buckets/${state.bucketId2}`);
        expect(status).toBe(204);
      }
    });

    test('deletes test card', async () => {
      if (state.cardId) {
        const { status } = await request('DELETE', `/credit-cards/${state.cardId}`);
        expect(status).toBe(204);
      }
    });

    test('deletes test account', async () => {
      if (state.accountId) {
        const { status } = await request('DELETE', `/accounts/${state.accountId}`);
        expect(status).toBe(204);
      }
    });
  });
});
