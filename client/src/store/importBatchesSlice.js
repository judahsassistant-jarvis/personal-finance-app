/**
 * Import batches — provenance + undo for CSV imports (audit Gap 4).
 *
 * Each `confirmImport` writes one batch doc with `imported_at`, count,
 * statement metadata, and the writing account. The Past-imports section of
 * the Import page lists batches sorted by imported_at desc; deleting a batch
 * cascades to remove every transaction tagged with its `import_batch_id`.
 */

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { COLLECTIONS } from '../firebase/schema.js';
import { fetchWhere, fetchByFieldIn, deleteDocById, batchDelete } from '../firebase/helpers.js';
import { transactionsRemovedByBatch } from './transactionActions.js';

const COLLECTION = COLLECTIONS.IMPORT_BATCHES;

export const fetchImportBatches = createAsyncThunk(
  'importBatches/fetch',
  async (_, { getState }) => {
    const uid = getState().auth.user?.uid;
    return fetchWhere(COLLECTION, uid, [], { field: 'imported_at', direction: 'desc' });
  },
);

/**
 * Cascade-delete a batch: walk transactions tagged with its `import_batch_id`,
 * batch-delete them, then delete the batch doc itself. Returns the ids of
 * everything removed so transactionsSlice can drop them from in-memory state.
 *
 * Confirms at the UI layer (window.confirm) before dispatching.
 */
export const removeImportBatch = createAsyncThunk(
  'importBatches/remove',
  async (batchId, { getState, dispatch }) => {
    const uid = getState().auth.user?.uid;
    if (!uid) throw new Error('removeImportBatch requires an authenticated user');
    const txs = await fetchByFieldIn('transactions', uid, 'import_batch_id', [batchId]);
    const txIds = txs.map((t) => t.id);
    if (txIds.length > 0) {
      await batchDelete('transactions', txIds);
    }
    await deleteDocById(COLLECTION, batchId);
    // Notify the transactions slice so it drops these from in-memory state
    // without needing to refetch.
    dispatch(transactionsRemovedByBatch({ batchId, transactionIds: txIds }));
    return { batchId, transactionIds: txIds };
  },
);

const slice = createSlice({
  name: 'importBatches',
  initialState: {
    items: [],
    loading: false,
    error: null,
  },
  reducers: {
    reset: (s) => { s.items = []; s.error = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchImportBatches.pending, (s) => { s.loading = true; });
    b.addCase(fetchImportBatches.fulfilled, (s, a) => { s.loading = false; s.items = a.payload; });
    b.addCase(fetchImportBatches.rejected, (s, a) => { s.loading = false; s.error = a.error.message; });
    b.addCase(removeImportBatch.fulfilled, (s, a) => {
      s.items = s.items.filter((x) => x.id !== a.payload.batchId);
    });
  },
});

export const { reset: resetImportBatches } = slice.actions;
export default slice.reducer;
