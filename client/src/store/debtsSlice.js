import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { COLLECTIONS, newDebtDoc } from '../firebase/schema.js';
import { fetchAll, createDoc, updateDocById, deleteDocById } from '../firebase/helpers.js';

const COLLECTION = COLLECTIONS.DEBTS;

export const fetchDebts = createAsyncThunk('debts/fetch', async (_, { getState }) => {
  const uid = getState().auth.user?.uid;
  return fetchAll(COLLECTION, uid, { orderByField: 'created', direction: 'asc' });
});

export const addDebt = createAsyncThunk('debts/add', async (input, { getState }) => {
  const uid = getState().auth.user.uid;
  const data = newDebtDoc({ user_id: uid, ...input });
  return createDoc(COLLECTION, uid, data);
});

export const editDebt = createAsyncThunk('debts/edit', async ({ id, ...updates }) => {
  return updateDocById(COLLECTION, id, updates);
});

export const removeDebt = createAsyncThunk('debts/remove', async (id) => {
  return deleteDocById(COLLECTION, id);
});

const slice = createSlice({
  name: 'debts',
  initialState: { items: [], loading: false, error: null },
  reducers: {
    reset: (state) => { state.items = []; state.error = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchDebts.pending, (s) => { s.loading = true; s.error = null; });
    b.addCase(fetchDebts.fulfilled, (s, a) => { s.loading = false; s.items = a.payload; });
    b.addCase(fetchDebts.rejected, (s, a) => { s.loading = false; s.error = a.error.message; });
    b.addCase(addDebt.fulfilled, (s, a) => { s.items.push(a.payload); });
    b.addCase(editDebt.fulfilled, (s, a) => {
      const i = s.items.findIndex((x) => x.id === a.payload.id);
      if (i >= 0) s.items[i] = { ...s.items[i], ...a.payload };
    });
    b.addCase(removeDebt.fulfilled, (s, a) => {
      s.items = s.items.filter((x) => x.id !== a.payload);
    });
  },
});

export const { reset: resetDebts } = slice.actions;
export default slice.reducer;
