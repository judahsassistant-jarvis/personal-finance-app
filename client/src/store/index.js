import { configureStore } from '@reduxjs/toolkit';
import authReducer from './authSlice.js';
import accountsReducer from './accountsSlice.js';
import debtsReducer from './debtsSlice.js';
import cardBucketsReducer from './cardBucketsSlice.js';
import transactionsReducer from './transactionsSlice.js';
import budgetsReducer from './budgetsSlice.js';
import debtConfigReducer from './debtConfigSlice.js';
import recurringBillsReducer from './recurringBillsSlice.js';
import systemReducer from './systemSlice.js';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    accounts: accountsReducer,
    debts: debtsReducer,
    cardBuckets: cardBucketsReducer,
    transactions: transactionsReducer,
    budgets: budgetsReducer,
    debtConfig: debtConfigReducer,
    recurringBills: recurringBillsReducer,
    system: systemReducer,
  },
});
