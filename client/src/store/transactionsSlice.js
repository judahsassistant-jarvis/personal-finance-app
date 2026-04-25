import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { Timestamp } from 'firebase/firestore';
import { COLLECTIONS, newTransactionDoc } from '../firebase/schema.js';
import {
  fetchWhere,
  createDoc,
  updateDocById,
  deleteDocById,
  batchCreate,
  batchUpdate,
} from '../firebase/helpers.js';
import { parseCSV } from '../services/csvParser.js';

const COLLECTION = COLLECTIONS.TRANSACTIONS;

export const fetchTransactions = createAsyncThunk('transactions/fetch', async (_, { getState }) => {
  const uid = getState().auth.user?.uid;
  return fetchWhere(COLLECTION, uid, [], { field: 'date', direction: 'desc' });
});

export const addTransaction = createAsyncThunk('transactions/add', async (input, { getState }) => {
  const uid = getState().auth.user.uid;
  const data = newTransactionDoc({
    user_id: uid,
    ...input,
    date: input.date instanceof Date ? Timestamp.fromDate(input.date) : input.date,
  });
  return createDoc(COLLECTION, uid, data);
});

export const editTransaction = createAsyncThunk('transactions/edit', async ({ id, ...updates }) => {
  return updateDocById(COLLECTION, id, updates);
});

export const removeTransaction = createAsyncThunk('transactions/remove', async (id) => {
  return deleteDocById(COLLECTION, id);
});

/**
 * Apply the same category to many transactions in one Firestore commit.
 * Used by the Transactions page when the user opts to "apply to all matching"
 * after recategorising a single row.
 */
export const bulkRecategorize = createAsyncThunk(
  'transactions/bulkRecategorize',
  async ({ ids, category }) => {
    const updates = ids.map((id) => ({ id, category }));
    await batchUpdate(COLLECTION, updates);
    return { ids, category };
  },
);

/**
 * Parse a CSV file in the browser. Keeps the result in state for review before
 * committing with confirmImport. User category rules (if loaded) take precedence
 * over the parser's hardcoded merchant->category map.
 */
export const parseCSVFile = createAsyncThunk('transactions/parseCSV', async ({ file, accountId }, { getState }) => {
  const text = await file.text();
  const userRules = getState().categoryRules?.items ?? [];
  return parseCSV(text, accountId, { userRules });
});

/** Commit the previewed import results to Firestore via a batched write. */
export const confirmImport = createAsyncThunk('transactions/confirmImport', async (_, { getState }) => {
  const uid = getState().auth.user.uid;
  const preview = getState().transactions.importResult;
  if (!preview || !preview.transactions) throw new Error('No import preview to confirm');
  const toWrite = preview.transactions.map((t) => ({
    ...t,
    date: typeof t.date === 'string' ? Timestamp.fromDate(new Date(t.date)) : t.date,
  }));
  return batchCreate(COLLECTION, uid, toWrite);
});

const slice = createSlice({
  name: 'transactions',
  initialState: {
    items: [],
    loading: false,
    error: null,
    importResult: null,
    importLoading: false,
  },
  reducers: {
    clearImport: (s) => { s.importResult = null; },
    updateImportTransaction: (s, action) => {
      if (!s.importResult) return;
      const { index, ...fields } = action.payload;
      Object.assign(s.importResult.transactions[index], fields);
    },
    reset: (s) => { s.items = []; s.importResult = null; s.error = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchTransactions.pending, (s) => { s.loading = true; });
    b.addCase(fetchTransactions.fulfilled, (s, a) => { s.loading = false; s.items = a.payload; });
    b.addCase(fetchTransactions.rejected, (s, a) => { s.loading = false; s.error = a.error.message; });
    b.addCase(addTransaction.fulfilled, (s, a) => { s.items.unshift(a.payload); });
    b.addCase(editTransaction.fulfilled, (s, a) => {
      const i = s.items.findIndex((x) => x.id === a.payload.id);
      if (i >= 0) s.items[i] = { ...s.items[i], ...a.payload };
    });
    b.addCase(removeTransaction.fulfilled, (s, a) => {
      s.items = s.items.filter((x) => x.id !== a.payload);
    });
    b.addCase(bulkRecategorize.fulfilled, (s, a) => {
      const { ids, category } = a.payload;
      const idSet = new Set(ids);
      for (const t of s.items) {
        if (idSet.has(t.id)) t.category = category;
      }
    });
    b.addCase(parseCSVFile.pending, (s) => { s.importLoading = true; s.error = null; });
    b.addCase(parseCSVFile.fulfilled, (s, a) => { s.importLoading = false; s.importResult = a.payload; });
    b.addCase(parseCSVFile.rejected, (s, a) => { s.importLoading = false; s.error = a.error.message; });
    b.addCase(confirmImport.fulfilled, (s, a) => {
      s.items = [...a.payload, ...s.items];
      s.importResult = null;
    });
  },
});

export const {
  clearImport, updateImportTransaction, reset: resetTransactions,
} = slice.actions;
export default slice.reducer;
