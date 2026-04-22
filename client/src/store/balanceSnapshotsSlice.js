import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { COLLECTIONS, newBalanceSnapshotDoc } from '../firebase/schema.js';
import { fetchAll, createDoc, updateDocById, deleteDocById } from '../firebase/helpers.js';

const COLLECTION = COLLECTIONS.BALANCE_SNAPSHOTS;

export const fetchBalanceSnapshots = createAsyncThunk('balanceSnapshots/fetch', async (_, { getState }) => {
  const uid = getState().auth.user?.uid;
  return fetchAll(COLLECTION, uid, { orderByField: 'as_of_date', direction: 'desc' });
});

export const addBalanceSnapshot = createAsyncThunk('balanceSnapshots/add', async (input, { getState }) => {
  const uid = getState().auth.user.uid;
  const data = newBalanceSnapshotDoc({ user_id: uid, ...input });
  return createDoc(COLLECTION, uid, data);
});

export const editBalanceSnapshot = createAsyncThunk('balanceSnapshots/edit', async ({ id, ...updates }) => {
  return updateDocById(COLLECTION, id, updates);
});

export const removeBalanceSnapshot = createAsyncThunk('balanceSnapshots/remove', async (id) => {
  return deleteDocById(COLLECTION, id);
});

const slice = createSlice({
  name: 'balanceSnapshots',
  initialState: { items: [], loading: false, error: null },
  reducers: {
    reset: (state) => { state.items = []; state.error = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchBalanceSnapshots.pending, (s) => { s.loading = true; s.error = null; });
    b.addCase(fetchBalanceSnapshots.fulfilled, (s, a) => { s.loading = false; s.items = a.payload; });
    b.addCase(fetchBalanceSnapshots.rejected, (s, a) => { s.loading = false; s.error = a.error.message; });
    b.addCase(addBalanceSnapshot.fulfilled, (s, a) => { s.items.unshift(a.payload); });
    b.addCase(editBalanceSnapshot.fulfilled, (s, a) => {
      const i = s.items.findIndex((x) => x.id === a.payload.id);
      if (i >= 0) s.items[i] = { ...s.items[i], ...a.payload };
    });
    b.addCase(removeBalanceSnapshot.fulfilled, (s, a) => {
      s.items = s.items.filter((x) => x.id !== a.payload);
    });
  },
});

export const { reset: resetBalanceSnapshots } = slice.actions;
export default slice.reducer;
