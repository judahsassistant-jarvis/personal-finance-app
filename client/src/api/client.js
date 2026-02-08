import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Accounts
export const getAccounts = () => api.get('/accounts');
export const createAccount = (data) => api.post('/accounts', data);
export const updateAccount = (id, data) => api.put(`/accounts/${id}`, data);
export const deleteAccount = (id) => api.delete(`/accounts/${id}`);

// Credit Cards
export const getCreditCards = () => api.get('/credit-cards');
export const createCreditCard = (data) => api.post('/credit-cards', data);
export const updateCreditCard = (id, data) => api.put(`/credit-cards/${id}`, data);
export const deleteCreditCard = (id) => api.delete(`/credit-cards/${id}`);

// Card Buckets
export const getCardBuckets = (cardId) => api.get('/card-buckets', { params: { card_id: cardId } });
export const createCardBucket = (data) => api.post('/card-buckets', data);
export const updateCardBucket = (id, data) => api.put(`/card-buckets/${id}`, data);
export const deleteCardBucket = (id) => api.delete(`/card-buckets/${id}`);

// Transactions
export const getTransactions = (params) => api.get('/transactions', { params });
export const updateTransaction = (id, data) => api.put(`/transactions/${id}`, data);
export const bulkUpdateTransactions = (updates) => api.patch('/transactions/bulk', { updates });

// Budgets
export const getBudgets = (month) => api.get('/budgets', { params: { month } });
export const createBudget = (data) => api.post('/budgets', data);
export const updateBudget = (id, data) => api.put(`/budgets/${id}`, data);
export const deleteBudget = (id) => api.delete(`/budgets/${id}`);

// Debt Config
export const getDebtConfig = (month) => api.get('/debt-config', { params: { month } });
export const createDebtConfig = (data) => api.post('/debt-config', data);
export const updateDebtConfig = (id, data) => api.put(`/debt-config/${id}`, data);

// Forecasts
export const getForecasts = (month) => api.get('/forecasts', { params: { month } });
export const getPayoffSchedule = () => api.get('/forecasts/payoff');

// Import
export const uploadCSV = (file, accountId) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('account_id', accountId);
  return api.post('/import/csv', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};
export const confirmImport = (transactions) => api.post('/import/confirm', { transactions });

export default api;
