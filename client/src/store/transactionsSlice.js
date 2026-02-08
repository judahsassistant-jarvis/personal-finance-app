import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { getTransactions, uploadCSV, confirmImport } from '../api/client';

export const fetchTransactions = createAsyncThunk('transactions/fetch', async (params) => {
  const { data } = await getTransactions(params);
  return data;
});

export const importCSV = createAsyncThunk('transactions/importCSV', async ({ file, accountId }) => {
  const { data } = await uploadCSV(file, accountId);
  return data;
});

export const saveImport = createAsyncThunk('transactions/saveImport', async (transactions) => {
  const { data } = await confirmImport(transactions);
  return data;
});

const transactionsSlice = createSlice({
  name: 'transactions',
  initialState: {
    items: [],
    total: 0,
    loading: false,
    error: null,
    importResult: null,
    importLoading: false,
  },
  reducers: {
    clearImport: (state) => {
      state.importResult = null;
    },
    updateImportTransaction: (state, action) => {
      if (state.importResult) {
        const { index, ...fields } = action.payload;
        Object.assign(state.importResult.transactions[index], fields);
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTransactions.pending, (state) => { state.loading = true; })
      .addCase(fetchTransactions.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload.transactions;
        state.total = action.payload.total;
      })
      .addCase(fetchTransactions.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      })
      .addCase(importCSV.pending, (state) => { state.importLoading = true; })
      .addCase(importCSV.fulfilled, (state, action) => {
        state.importLoading = false;
        state.importResult = action.payload;
      })
      .addCase(importCSV.rejected, (state, action) => {
        state.importLoading = false;
        state.error = action.error.message;
      })
      .addCase(saveImport.fulfilled, (state) => {
        state.importResult = null;
      });
  },
});

export const { clearImport, updateImportTransaction } = transactionsSlice.actions;
export default transactionsSlice.reducer;
