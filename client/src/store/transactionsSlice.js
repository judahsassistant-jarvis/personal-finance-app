import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { Timestamp } from 'firebase/firestore';
import { COLLECTIONS, newTransactionDoc } from '../firebase/schema.js';
import {
  fetchWhere,
  fetchByFieldIn,
  createDoc,
  updateDocById,
  deleteDocById,
  batchCreate,
  batchUpdate,
} from '../firebase/helpers.js';
import { parseCSV } from '../services/csvParser.js';
import { pairIdFor } from '../services/transferPairing.js';

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

/**
 * Confirm a cross-account transfer pair. Writes a shared `transfer_pair_id`
 * to both rows and sets `category = 'Transfer'` on each side ONLY if the
 * current category is 'Other' / 'Income' (the auto-set values for unmatched
 * outflows / inflows). Manual user categorisations are preserved.
 */
export const confirmTransferPair = createAsyncThunk(
  'transactions/confirmTransferPair',
  async ({ outflowId, inflowId }, { getState }) => {
    const items = getState().transactions.items;
    const outflow = items.find((t) => t.id === outflowId);
    const inflow = items.find((t) => t.id === inflowId);
    if (!outflow || !inflow) throw new Error('Pair endpoints not loaded');
    const pairId = pairIdFor(outflowId, inflowId);
    const TRANSFER_OVERRIDE_CATEGORIES = new Set(['Other', 'Income']);
    const updates = [
      {
        id: outflowId,
        transfer_pair_id: pairId,
        ...(TRANSFER_OVERRIDE_CATEGORIES.has(outflow.category) ? { category: 'Transfer' } : {}),
      },
      {
        id: inflowId,
        transfer_pair_id: pairId,
        ...(TRANSFER_OVERRIDE_CATEGORIES.has(inflow.category) ? { category: 'Transfer' } : {}),
      },
    ];
    await batchUpdate(COLLECTION, updates);
    return { outflowId, inflowId, pairId, updates };
  },
);

/**
 * Dismiss a transfer-pair suggestion. Stamps `pair_dismissed_at` on both rows
 * so the suggestion doesn't keep re-appearing on every Transactions render.
 */
export const dismissTransferPair = createAsyncThunk(
  'transactions/dismissTransferPair',
  async ({ outflowId, inflowId }) => {
    const ts = Timestamp.now();
    const updates = [
      { id: outflowId, pair_dismissed_at: ts },
      { id: inflowId, pair_dismissed_at: ts },
    ];
    await batchUpdate(COLLECTION, updates);
    return { outflowId, inflowId, pair_dismissed_at: ts };
  },
);

/**
 * Commit the previewed import results to Firestore via a batched write.
 *
 * Audit Gap 1 — re-import deduplication: before writing, query existing
 * transactions matching the candidate `dedup_key`s. Skip rows whose key
 * already exists. This makes re-imports of the same statement (or
 * overlapping date ranges across two statements) idempotent — no silent
 * duplicates. User-edited fields on existing rows (category, debt_id,
 * transfer_pair_id, etc.) are preserved because we skip rather than
 * upsert-overwrite.
 */
export const confirmImport = createAsyncThunk('transactions/confirmImport', async (_, { getState }) => {
  const uid = getState().auth.user.uid;
  const preview = getState().transactions.importResult;
  if (!preview || !preview.transactions) throw new Error('No import preview to confirm');
  const candidates = preview.transactions;
  const keys = candidates.map((t) => t.dedup_key).filter(Boolean);
  const existing = keys.length > 0
    ? await fetchByFieldIn(COLLECTION, uid, 'dedup_key', keys)
    : [];
  const existingKeys = new Set(existing.map((t) => t.dedup_key).filter(Boolean));
  const fresh = candidates.filter((t) => !t.dedup_key || !existingKeys.has(t.dedup_key));
  const toWrite = fresh.map((t) => ({
    ...t,
    date: typeof t.date === 'string' ? Timestamp.fromDate(new Date(t.date)) : t.date,
  }));
  const written = toWrite.length > 0 ? await batchCreate(COLLECTION, uid, toWrite) : [];
  return { written, skipped: candidates.length - fresh.length };
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
    b.addCase(confirmTransferPair.fulfilled, (s, a) => {
      const byId = new Map(a.payload.updates.map((u) => [u.id, u]));
      for (const t of s.items) {
        const u = byId.get(t.id);
        if (u) Object.assign(t, u);
      }
    });
    b.addCase(dismissTransferPair.fulfilled, (s, a) => {
      const { outflowId, inflowId, pair_dismissed_at } = a.payload;
      for (const t of s.items) {
        if (t.id === outflowId || t.id === inflowId) {
          t.pair_dismissed_at = pair_dismissed_at;
        }
      }
    });
    b.addCase(parseCSVFile.pending, (s) => { s.importLoading = true; s.error = null; });
    b.addCase(parseCSVFile.fulfilled, (s, a) => { s.importLoading = false; s.importResult = a.payload; });
    b.addCase(parseCSVFile.rejected, (s, a) => { s.importLoading = false; s.error = a.error.message; });
    b.addCase(confirmImport.fulfilled, (s, a) => {
      s.items = [...a.payload.written, ...s.items];
      s.importResult = null;
    });
  },
});

export const {
  clearImport, updateImportTransaction, reset: resetTransactions,
} = slice.actions;
export default slice.reducer;
