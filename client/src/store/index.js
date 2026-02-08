import { configureStore } from '@reduxjs/toolkit';
import accountsReducer from './accountsSlice';
import cardsReducer from './cardsSlice';
import transactionsReducer from './transactionsSlice';

export const store = configureStore({
  reducer: {
    accounts: accountsReducer,
    cards: cardsReducer,
    transactions: transactionsReducer,
  },
});
